# HCG ADS — Swift SDK

Swift package for Apple platforms (iOS 16+, macOS 13+) implementing the HCG ADS public delivery contract, version 1.

> **Status: written, not yet compiled.** This package was written in a Linux environment without a Swift
> toolchain (no `swiftlang` package is available for the container's Ubuntu 24.04). It has **not been built, run or
> tested** on any platform yet. Expect small compile fixes on the first `swift build` in Xcode. Do not ship it in the
> HCG News iOS app until `swift build` and `swift test` pass and the view has been checked on a device.

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
