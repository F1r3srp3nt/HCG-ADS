#if canImport(SwiftUI)
import SwiftUI
import HCGAdsCore
#if canImport(AVKit)
import AVKit
#endif

/// Environment value carrying the shared client.
private struct HCGAdsClientKey: EnvironmentKey { static let defaultValue: HCGAdsClient? = nil }

public extension EnvironmentValues {
    var hcgAdsClient: HCGAdsClient? {
        get { self[HCGAdsClientKey.self] }
        set { self[HCGAdsClientKey.self] = newValue }
    }
}

public extension View {
    /// Provides the HCG ADS client to placements below this view.
    func hcgAds(_ client: HCGAdsClient) -> some View { environment(\.hcgAdsClient, client) }
}

/// An HCG ADS placement. Shows nothing (collapses) when no ad is available or anything fails.
public struct HCGAdView: View {
    let placement: String
    let context: AdContext?
    @Environment(\.hcgAdsClient) private var client
    @Environment(\.openURL) private var openURL
    @State private var result: AdResult?
    @State private var viewTask: Task<Void, Never>?

    public init(placement: String, context: AdContext? = nil) {
        self.placement = placement
        self.context = context
    }

    public var body: some View {
        Group {
            switch result {
            case let .ad(ad, info):
                AdCard(ad: ad, placement: info) { open(ad) } onMediaError: { failed(ad) }
                    .onAppear { startViewability(ad) }
                    .onDisappear { viewTask?.cancel(); viewTask = nil }
                    .task(id: ad.deliveryId) { await client?.didRender(ad) }
            case let .empty(_, fallback, info) where fallback == .keepSpace && info?.height != nil:
                Color.clear.frame(height: CGFloat(info!.height!)).accessibilityHidden(true)
            default:
                EmptyView()
            }
        }
        .task(id: placement) {
            guard let client else { result = .empty(reason: "no_client", fallback: .collapse, placement: nil); return }
            result = await client.request(placement: placement, context: context, device: Self.device)
        }
    }

    /// Viewable: on screen for one continuous second.
    private func startViewability(_ ad: RenderableAd) {
        viewTask?.cancel()
        viewTask = Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if !Task.isCancelled { await client?.track(ad, .viewable) }
        }
    }

    private func open(_ ad: RenderableAd) {
        Task {
            guard let client else { return }
            openURL(await client.clickURL(for: ad))
        }
    }

    private func failed(_ ad: RenderableAd) {
        Task { await client?.track(ad, .error) }
        result = .empty(reason: "media_error", fallback: .collapse, placement: nil)
    }

    private static var device: DeviceClass {
        #if os(iOS)
        return UIDevice.current.userInterfaceIdiom == .pad ? .tablet : .mobile
        #else
        return .desktop
        #endif
    }
}

/// Renders a RenderableAd: disclosure always visible, media framed explicitly, never stretched.
struct AdCard: View {
    let ad: RenderableAd
    let placement: PlacementInfo?
    let onTap: () -> Void
    let onMediaError: () -> Void

    private var isMediaCreative: Bool {
        guard let m = ad.media else { return false }
        return (ad.type == .image || ad.type == .video) && m.kind != .native
    }

    var body: some View {
        content
            .frame(width: fixedWidth, height: fixedHeight)
            .frame(maxWidth: placement?.responsive == .responsiveNative ? .infinity : nil)
            .background(Color.primary.opacity(0.03))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.14)))
            .overlay(alignment: .topLeading) { Disclosure(text: ad.disclosure).padding(6) }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(ad.disclosure): \(ad.headline), \(ad.sponsorName)")
            .accessibilityAddTraits(.isLink)
    }

    private var fixedWidth: CGFloat? {
        guard let p = placement, p.responsive == .fixed, let w = p.width else { return nil }
        return CGFloat(w)
    }
    private var fixedHeight: CGFloat? {
        guard let p = placement, p.responsive != .responsiveNative, let h = p.height else { return nil }
        return CGFloat(h)
    }

    @ViewBuilder private var content: some View {
        if isMediaCreative, let media = ad.media {
            if media.kind == .video {
                VideoCreative(ad: ad, media: media, onTap: onTap)
            } else {
                Button(action: onTap) { MediaImage(media: media, onError: onMediaError) }.buttonStyle(.plain)
            }
        } else {
            Button(action: onTap) { NativeCard(ad: ad, horizontal: placement?.isHorizontal ?? false, onMediaError: onMediaError) }
                .buttonStyle(.plain)
        }
    }
}

struct Disclosure: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(Color.black.opacity(0.78)))
            .allowsHitTesting(false)
    }
}

struct NativeCard: View {
    let ad: RenderableAd
    let horizontal: Bool
    let onMediaError: () -> Void

    var body: some View {
        let layout = horizontal ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
        layout {
            if let media = ad.media, media.kind != .video {
                MediaImage(media: media, onError: onMediaError, fill: true)
                    .frame(maxWidth: horizontal ? 120 : .infinity)
                    .aspectRatio(media.cropAspect ?? (16.0 / 9.0), contentMode: .fit)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(ad.sponsorName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(ad.headline).font(.headline).lineLimit(3)
                if let d = ad.description, !horizontal { Text(d).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                Text(ad.callToAction)
                    .font(.footnote.weight(.semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Capsule().fill(Color.accentColor))
                    .padding(.top, 4)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .padding(.top, ad.media == nil ? 20 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension AdMedia {
    /// Aspect ratio of the crop rectangle when the media size is known.
    var cropAspect: Double? {
        guard let c = crop, let w = width, let h = height, c.height > 0 else { return nil }
        return (c.width * Double(w)) / (c.height * Double(h))
    }
}

/// An image framed by its explicit crop, or fitted (contain) when there is none.
struct MediaImage: View {
    let media: AdMedia
    let onError: () -> Void
    var fill: Bool = false

    var body: some View {
        GeometryReader { geo in
            AsyncImage(url: media.url) { phase in
                switch phase {
                case let .success(image):
                    if let crop = media.crop {
                        // Uniform scale so the crop rect's width fills the box; the box clips the rest.
                        let scale = geo.size.width / max(crop.width, 0.0001)
                        image.resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: scale)
                            .offset(x: -crop.x * scale, y: -crop.y * (geo.size.height / max(crop.height, 0.0001)))
                            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                    } else {
                        image.resizable()
                            .aspectRatio(contentMode: fill ? .fill : .fit)
                            .frame(width: geo.size.width, height: geo.size.height)
                    }
                case .failure:
                    Color.clear.onAppear(perform: onError)
                default:
                    Color.primary.opacity(0.06)
                }
            }
        }
        .clipped()
        .accessibilityLabel(media.alt ?? "")
    }
}

struct VideoCreative: View {
    let ad: RenderableAd
    let media: AdMedia
    let onTap: () -> Void

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            #if canImport(AVKit)
            VideoPlayerView(url: media.url, ad: ad)
            #else
            Color.black
            #endif
            Button(ad.callToAction, action: onTap)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Capsule().fill(Color.accentColor))
                .padding(8)
        }
        .aspectRatio(media.width.flatMap { w in media.height.map { Double(w) / Double($0) } } ?? 16.0 / 9.0, contentMode: .fit)
        .background(Color.black)
    }
}

#if canImport(AVKit)
/// Muted, inline, user-controlled video. Reports quartile milestones once each.
struct VideoPlayerView: View {
    let url: URL
    let ad: RenderableAd
    @Environment(\.hcgAdsClient) private var client
    @State private var player: AVPlayer?
    @State private var observer: Any?

    var body: some View {
        VideoPlayer(player: player)
            .onAppear {
                let p = AVPlayer(url: url)
                p.isMuted = true
                player = p
                observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { time in
                    guard let duration = p.currentItem?.duration.seconds, duration.isFinite, duration > 0 else { return }
                    let progress = time.seconds / duration
                    let marks: [(Double, EventType)] = [(0.0001, .videoStart), (0.25, .video25), (0.5, .video50), (0.75, .video75), (0.99, .videoComplete)]
                    for (at, type) in marks where progress >= at {
                        Task { await client?.track(ad, type) }
                    }
                }
            }
            .onDisappear {
                if let observer { player?.removeTimeObserver(observer) }
                player?.pause()
            }
    }
}
#endif
#endif
