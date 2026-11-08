import Foundation

/// Any JSON value, for the few fields the API leaves open (for example a stored snapshot's
/// extra keys). Prefer typed models everywhere else.
enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

/// An enum decoded from a string that never fails: values the app doesn't know yet decode
/// as `.unknown`, so a new server value can't break a whole response.
/// Conform a `String`-backed enum that has a `case unknown` and list it last.
protocol LenientEnum: RawRepresentable, CaseIterable, Codable, Hashable, Sendable where RawValue == String {
    static var unknownCase: Self { get }
}

extension LenientEnum {
    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownCase
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    /// Every case except `.unknown`, in declaration order (for pickers).
    static var knownCases: [Self] { allCases.filter { $0 != unknownCase } }
}

extension KeyedEncodingContainer {
    /// PATCH helper: `nil` omits the key (leave unchanged), `.some(nil)` sends `null` (clear),
    /// `.some(value)` sends the value.
    mutating func encodePatch<T: Encodable>(_ value: T??, forKey key: Key) throws {
        guard let value else { return }
        try encode(value, forKey: key)
    }
}

extension KeyedDecodingContainer {
    /// Tri-state read: key absent -> nil, `null` -> .some(nil), value -> .some(value).
    func decodePresence<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T?? {
        guard contains(key) else { return nil }
        return .some(try decodeIfPresent(type, forKey: key))
    }
}
