import SafariServices
import SwiftUI

/// `SFSafariViewController` in a sheet, for pages that only exist on the web
/// (shared trip pages, outside links).
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// A URL that can drive `.sheet(item:)`.
struct WebPage: Identifiable, Hashable, Sendable {
    let url: URL
    var id: String { url.absoluteString }
}
