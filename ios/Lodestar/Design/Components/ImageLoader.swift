import SwiftUI
import UIKit

/// Loads and caches images through the app's `APIClient` (same cookie session, so
/// `/api/places/photo` works when signed in, and its 302 is followed).
actor ImageLoader {
    enum Result: Sendable {
        case image(UIImage)
        /// SVG monogram fallback or undecodable bytes: draw `Monogram` instead.
        case monogram
        case failed
    }

    private let api: APIClient
    private var cache: [String: Result] = [:]
    private var order: [String] = []
    private var inFlight: [String: Task<Result, Never>] = [:]
    private let limit = 300

    init(api: APIClient) {
        self.api = api
    }

    func load(_ pathOrURL: String) async -> Result {
        if let cached = cache[pathOrURL] { return cached }
        if let running = inFlight[pathOrURL] { return await running.value }

        let api = api
        let task = Task<Result, Never> {
            do {
                let (data, contentType) = try await api.fetchData(pathOrURL)
                return Self.decode(data: data, contentType: contentType)
            } catch {
                return .failed
            }
        }
        inFlight[pathOrURL] = task
        let result = await task.value
        inFlight[pathOrURL] = nil
        if case .failed = result { return result }
        store(result, for: pathOrURL)
        return result
    }

    nonisolated static func decode(data: Data, contentType: String?) -> Result {
        if let type = contentType?.lowercased(), type.contains("svg") { return .monogram }
        guard let image = UIImage(data: data) else { return .monogram }
        return .image(image)
    }

    private func store(_ result: Result, for key: String) {
        cache[key] = result
        order.append(key)
        if order.count > limit {
            let evicted = order.removeFirst()
            cache[evicted] = nil
        }
    }
}

extension EnvironmentValues {
    /// Injected at the root from `AppState.api`. The default only exists so previews compile.
    @Entry var imageLoader: ImageLoader = ImageLoader.preview
}

extension ImageLoader {
    static let preview = ImageLoader(api: APIClient())
}
