import Foundation
@testable import Lodestar

/// Wraps `data` JSON in the success envelope and decodes it the way the app does.
func decodeEnvelope<T: Decodable>(_ dataJSON: String, as type: T.Type, status: Int = 200) throws -> T {
    let body = #"{"ok":true,"data":"# + dataJSON + "}"
    return try ResponseDecoder.decode(T.self, data: Data(body.utf8), status: status)
}

/// Encodes a value and parses it back to a dictionary for key assertions.
func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
    let data = try JSONCoding.encoder.encode(value)
    return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any] ?? [:]
}

func date(_ s: String) -> LocalDate { LocalDate(s)! }
