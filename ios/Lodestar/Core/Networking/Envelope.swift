import Foundation

/// `{ok: true, data}` or `{ok: false, error}`, the shape of every JSON route.
struct Envelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
}

/// Only the parts of the envelope that never depend on `T`.
private struct EnvelopeHead: Decodable {
    let ok: Bool?
    let error: String?
}

/// Turns a raw HTTP response into the route's `data`, mirroring the web's `lib/client.ts`:
/// not 2xx or `ok != true` throws `APIError.server` with the server's sentence, or
/// `APIError.http` ("Request failed (HTTP n).") when the body isn't the envelope.
enum ResponseDecoder {
    static func decode<T: Decodable>(_ type: T.Type, data: Data, status: Int) throws(APIError) -> T {
        let head = try? JSONCoding.decoder.decode(EnvelopeHead.self, from: data)
        let success = (200..<300).contains(status)

        guard success, head?.ok == true else {
            if let message = head?.error, !message.isEmpty {
                throw .server(status: status, message: message)
            }
            throw .http(status: status)
        }

        do {
            let envelope = try JSONCoding.decoder.decode(Envelope<T>.self, from: data)
            if let value = envelope.data { return value }
            // `data` absent or null: fine for routes that answer `{}`.
            if let empty = EmptyResponse() as? T { return empty }
            throw APIError.decoding(detail: "Missing data for \(T.self)")
        } catch let error as APIError {
            throw error
        } catch {
            throw .decoding(detail: describe(error, for: T.self))
        }
    }

    /// The error from a non-JSON-route response (logo, photo, stream) that failed.
    static func failure(data: Data, status: Int) -> APIError {
        if let head = try? JSONCoding.decoder.decode(EnvelopeHead.self, from: data),
           let message = head.error, !message.isEmpty {
            return .server(status: status, message: message)
        }
        return .http(status: status)
    }

    static func describe(_ error: any Error, for type: Any.Type) -> String {
        guard let decoding = error as? DecodingError else { return "\(type): \(error)" }
        switch decoding {
        case .keyNotFound(let key, let context):
            return "\(type): missing \(key.stringValue) at \(path(context))"
        case .typeMismatch(let expected, let context):
            return "\(type): expected \(expected) at \(path(context))"
        case .valueNotFound(let expected, let context):
            return "\(type): null \(expected) at \(path(context))"
        case .dataCorrupted(let context):
            return "\(type): corrupted at \(path(context)): \(context.debugDescription)"
        @unknown default:
            return "\(type): \(decoding)"
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        context.codingPath.map(\.stringValue).joined(separator: ".")
    }
}
