import Foundation

/// Where the app talks to. The default comes from Info.plist (`LodestarBaseURL`);
/// the `apiBaseURL` user default overrides it, which also makes the launch argument
/// `-apiBaseURL http://localhost:3000` work for a local dev server.
struct APIConfig: Sendable, Equatable {
    static let defaultBaseURL = URL(string: "https://lodestar.xanom.co")!
    static let overrideKey = "apiBaseURL"

    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    /// Reads the override, then Info.plist, then the built-in default.
    static func current(defaults: UserDefaults = .standard, bundle: Bundle = .main) -> APIConfig {
        if let url = validURL(defaults.string(forKey: overrideKey)) {
            return APIConfig(baseURL: url)
        }
        if let url = validURL(bundle.object(forInfoDictionaryKey: "LodestarBaseURL") as? String) {
            return APIConfig(baseURL: url)
        }
        return APIConfig(baseURL: defaultBaseURL)
    }

    /// Resolves a server-relative path such as `/api/logo/airline/UA` or an absolute URL.
    func resolve(_ pathOrURL: String) -> URL? {
        if let absolute = URL(string: pathOrURL), absolute.scheme != nil {
            return absolute
        }
        return URL(string: pathOrURL, relativeTo: baseURL)?.absoluteURL
    }

    /// The public share page for a trip: `<base>/t/<token>`.
    func shareURL(token: String) -> URL {
        baseURL.appending(path: "t").appending(path: token)
    }

    private static func validURL(_ string: String?) -> URL? {
        guard let string, let url = URL(string: string),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host() != nil
        else { return nil }
        return url
    }
}
