# HCG ADS — .NET / Avalonia SDK (interface specification)

Status: **specification only, no code yet.** It describes the SDK for future HCG desktop apps (Avalonia, .NET 8+)
so it matches the JavaScript and Swift SDKs and the delivery contract, version 1.

## Packages

- `HCG.Ads.Core` (netstandard2.1 / net8.0, no UI dependency): models, client, consent, frequency, measurement.
- `HCG.Ads.Avalonia`: the `HCGAdView` control.

## Contract

Same HTTP contract as every HCG ADS SDK (see `packages/contracts/src/index.ts`):

- `POST {endpoint}/delivery/v1/ad` with `DeliveryRequest` JSON
  `{ placement, platform: "windows" | "macos" | "linux" | "desktop", device: "desktop", context?, consent, exclude?, sdk: { name: "hcg-ads-dotnet", version } }`
  and header `X-HCG-App-Id: <registered app id>`. No API keys; public integrations must never contain privileged keys.
- Response `DeliveryResponse { contractVersion: "1", placement, ad, reason? }`. Any other `contractVersion` is treated as empty.
- Events: `POST` to `ad.Beacons.Impression`, `ad.Beacons.Viewable`; video and error events to the `Beacons.Video` URL with its last path segment
  replaced by the event type (`video_start`, `video_25`, `video_50`, `video_75`, `video_complete`, `error`).
- Clicks: open `ad.ClickUrl` in the system browser (append `m=0` without measurement consent). The server records and redirects.

## Core API

```csharp
public sealed record Consent(bool Storage, bool Measurement);

public sealed class HCGAdsOptions {
    public required Uri Endpoint { get; init; }
    public string? AppId { get; init; }            // defaults to the entry assembly name
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(3);
    public Consent Consent { get; set; } = new(false, true);
}

public sealed class HCGAdsClient {
    public HCGAdsClient(HCGAdsOptions options, HttpMessageHandler? handler = null, IFrequencyStore? store = null);
    public Task<AdResult> RequestAsync(string placement, AdContext? context = null, CancellationToken ct = default); // never throws
    public Task DidRenderAsync(RenderableAd ad);                    // records frequency + impression (once)
    public Task<bool> TrackAsync(RenderableAd ad, EventType type);  // once per DeliveryId+type, only with measurement consent, never for previews
    public Uri ClickUri(RenderableAd ad);
    public void SetConsent(Consent consent);                        // withdrawing storage clears the persisted counters
}

public abstract record AdResult {
    public sealed record Ad(RenderableAd Value, PlacementInfo? Placement) : AdResult;
    public sealed record Empty(string Reason, FallbackBehavior Fallback, PlacementInfo? Placement) : AdResult;
}
```

- Frequency: counters per campaign `{ count, windowHours, timestamps }`, pruned to the window; capped campaign ids are sent as `exclude`.
  Persisted (per-user app data, JSON) only with storage consent, memory otherwise. Counters never leave the device.
- No response caching; each request is a new delivery.

## Avalonia control

`<hcg:HCGAdView Placement="plc_pub_…" Category="technology" />`

- Native/article card: optional image, disclosure chip (always visible, top-left, text from `ad.Disclosure`), sponsor, headline,
  description, call-to-action. Horizontal layout when the placement is fixed and width/height > 2.5, stacked otherwise.
- Fixed placements get the exact size; `responsive-native` fills the available width.
- Media: explicit crop (`CropRect`, normalised 0..1) when present, otherwise `Stretch="Uniform"`. Never `Fill`.
- Viewable: at least 50% of the control visible for one continuous second.
- Empty/error: `IsVisible = false` (collapse), or reserve `placement.Height` for `keep-space`.
- All ad text is plain text; ad data is never interpreted as markup.
