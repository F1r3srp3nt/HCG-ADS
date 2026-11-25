# HCG ADS — Swift SDK

Swift package for Apple platforms (iOS 16+, macOS 13+) implementing the HCG ADS public delivery contract, version 1.

> **Status: compiled and tested by CI, not yet on a device.** No Swift toolchain exists in the development
> container, so validation runs on GitHub's runners in `.github/workflows/native-sdks.yml`:
> `swift build` + `swift test` on Linux (`swift:5.10`, `HCGAdsCore`), `swift build` + `swift test` on macOS
> (`HCGAdsCore` + `HCGAdsUI`), and an `xcodebuild` build of the package for the iOS Simulator. Check the latest
> "Native SDKs" run before relying on it. The view has not been checked on a device; do not ship it in the HCG News
> iOS app before that.
>
> Changes made for compilation (25 Nov 2026, by inspection): no captured `var` in `@Sendable` closures; on Linux
> `URLSessionTransport` wraps the completion-handler API (async URLSession availability varies by toolchain); the
> timeout helper returns `Data` only (no non-`Sendable` tuple); explicit `UIKit` import for `UIDevice`; explicit
> `CGFloat` conversions in the media framing.

## Modules

| Module | Depends on | Contents |
| --- | --- | --- |
| `HCGAdsCore` | Foundation only | Contract v1 `Codable` models, `HCGAdsClient` actor (URLSession, injectable `HCGAdsTransport`, timeout, `X-HCG-App-Id` header from the bundle identifier), consent, `FrequencyStore` (UserDefaults only with storage consent, memory otherwise), deduplicated impression / viewable / video / error beacons, click URL (`m=0` without measurement consent), fallback as `AdResult.empty(reason:fallback:placement:)`. |
| `HCGAdsUI` | SwiftUI, AVKit | `HCGAdView(placement:context:)`: native card or media creative; disclosure label always visible; image framed with the explicit crop, or `.fit` when there is none (never stretched); video via `VideoPlayer`, muted, with quartile milestones; viewable after one continuous second on screen. Guarded by `#if canImport(SwiftUI)` so `HCGAdsCore` can build on Linux. |

## Use

```swift
import HCGAdsCore
import HCGAdsUI

let ads = HCGAdsClient(
    configuration: .init(endpoint: URL(string: "https://ads.hakmicapitalgroup.com")!),  // public API, no keys
    consent: Consent(storage: false, measurement: true)
)

struct ArticleScreen: View {
    var body: some View {
        ScrollView {
            // ...article...
            HCGAdView(placement: "plc_pub_…", context: AdContext(category: "technology"))
        }
        .hcgAds(ads)
    }
}
```

- The app must be registered with HCG ADS (publisher → apps) using its bundle identifier; the SDK sends it as `X-HCG-App-Id`.
- The SDK never contains or accepts privileged keys. Placement public keys are not secrets.
- Responses are not cached; each `request` is a new delivery.
- When nothing is available or anything fails, `HCGAdView` renders `EmptyView()` (collapse), or a clear frame of the placement height for `keep-space`. `house-ad` is decided by the server.

## Build and test (on a Mac)

```sh
cd sdk/swift/HCGAds
swift build
swift test          # HCGAdsCoreTests: decoding, contract version, beacon dedup, consent, frequency limits
```

On Linux, `swift build --target HCGAdsCore` and `swift test` should work (FoundationNetworking is imported where needed); the UI module compiles to nothing there.
