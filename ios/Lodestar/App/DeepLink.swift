import Foundation

/// Links the app can open: `lodestar://reset?token=…`, `lodestar://t/{token}`, and the same
/// paths on the web host (`https://lodestar.xanom.co/reset?token=…`, `/t/{token}`), which
/// reach the app once the site serves an apple-app-site-association file (see ios/README.md).
enum DeepLink: Equatable, Sendable {
    /// The emailed password reset link, as pasted into the reset form.
    case resetPassword(link: String)
    /// A shared trip page. It is HTML only, so the app shows it in Safari View.
    case sharedTrip(URL)

    static let scheme = "lodestar"

    /// nil for anything the app doesn't handle (another host, an unknown path).
    static func parse(_ url: URL, webBase: URL) -> DeepLink? {
        guard let parts = pathParts(url, webBase: webBase), let first = parts.first else { return nil }
        switch first {
        case "reset":
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
                  ResetRequest.token(fromLink: token) != nil
            else { return nil }
            return .resetPassword(link: token)
        case "t":
            guard parts.count == 2, isShareToken(parts[1]) else { return nil }
            return .sharedTrip(webBase.appending(path: "t").appending(path: parts[1]))
        default:
            return nil
        }
    }

    /// `lodestar://reset` puts "reset" in the host; `https://host/reset` puts it in the path.
    private static func pathParts(_ url: URL, webBase: URL) -> [String]? {
        let path = url.pathComponents.filter { $0 != "/" }
        if url.scheme?.lowercased() == scheme {
            return [url.host()].compactMap { $0 } + path
        }
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host()?.lowercased(), host == webBase.host()?.lowercased()
        else { return nil }
        return path
    }

    private static func isShareToken(_ token: String) -> Bool {
        !token.isEmpty && token.count <= 100
            && token.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }
}
