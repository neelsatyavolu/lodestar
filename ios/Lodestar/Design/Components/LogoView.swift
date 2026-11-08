import SwiftUI

/// An airline or seller logo from `/api/logo/*`: white tile, 2 pt padding, 8 pt radius,
/// never broken (falls back to a drawn `Monogram`). Sizes the web uses: 28 for one airline,
/// 22 for two (overlapping), 20 per leg, 24 in airline chips.
struct LogoView: View {
    /// Server-relative path (`/api/logo/airline/UA`, `VerifiedSeller.logo`).
    let path: String
    /// Used for the monogram and accessibility label.
    let name: String
    var size: CGFloat = 28

    @Environment(\.imageLoader) private var loader
    @State private var result: ImageLoader.Result?

    init(path: String, name: String, size: CGFloat = 28) {
        self.path = path
        self.name = name
        self.size = size
    }

    /// Airline logo by IATA code.
    init(airline: AirlineRef, size: CGFloat = 28) {
        self.init(path: API.Logos.airlinePath(code: airline.code), name: airline.displayName, size: size)
    }

    var body: some View {
        content
            .frame(width: size, height: size)
            .task(id: path) { result = await loader.load(path) }
            .accessibilityLabel(name)
    }

    @ViewBuilder private var content: some View {
        switch result {
        case .image(let image):
            Image(uiImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .padding(2)
                .frame(width: size, height: size)
                .background(Color.white, in: RoundedRectangle(cornerRadius: Radius.md * size / 28))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md * size / 28))
        case .monogram, .failed:
            Monogram(name: name, size: size)
        case nil:
            RoundedRectangle(cornerRadius: Radius.md * size / 28).fill(Color.elevated)
        }
    }
}

/// A photo or thumbnail (hotel image, place photo). Shows an empty elevated box while loading
/// or when the image fails, matching the web.
///
/// Takes exactly the size it is given (callers set the frame) and crops the photo to it. The
/// photo sits in an overlay so its fill size can never grow the view past that frame.
struct RemoteImage: View {
    /// Absolute URL or server-relative path (e.g. `API.Places.photoPath(name:width:)`).
    let source: String?
    var cornerRadius: CGFloat = Radius.md

    @Environment(\.imageLoader) private var loader
    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(Color.elevated)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
        .task(id: source) {
            image = nil
            guard let source else { return }
            if case .image(let loaded) = await loader.load(source) { image = loaded }
        }
        .accessibilityHidden(true)
    }
}
