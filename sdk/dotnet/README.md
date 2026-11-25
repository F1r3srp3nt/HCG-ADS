# HCG ADS — .NET SDK (+ Avalonia control)

.NET implementation of the HCG ADS public delivery contract, version 1, for HCG desktop apps (Windows, macOS,
Linux). Public delivery API only: **no keys are needed or accepted.**

| Project | Targets | Contents |
|---|---|---|
| `src/HCGAds` (`HCG.Ads`) | `netstandard2.0`, `net8.0` | Contract models (System.Text.Json, unknown fields ignored), `HCGAdsClient`, consent, `FrequencyStore`, beacons, `MediaMath` |
| `src/HCGAds.Avalonia` (`HCG.Ads.Avalonia`) | `net8.0`, Avalonia 11.1 | `HCGAdView` placement control and `HCGAdCard` renderer |
| `tests/HCGAds.Tests` | xUnit | Client, contract, frequency, media maths, and an opt-in live test against a real server |
| `tests/HCGAds.Avalonia.Tests` | xUnit + Avalonia headless | Rendering, disclosure, plain text, collapse/keep-space, click URL |

## Use

```csharp
using HCG.Ads;

var ads = new HCGAdsClient(new HttpClient(), new HCGAdsOptions
{
    Endpoint = new Uri("https://ads.hakmicapitalgroup.com/"),   // public delivery API, no keys
    AppId = "com.hakmicapitalgroup.yourapp",                    // must be registered on the publisher
    Platform = "windows",
    Consent = new Consent(storage: false, measurement: true),
    // Persist frequency counters only with storage consent:
    Frequency = new FrequencyStore(Path.Combine(appData, "hcg-ads", "frequency.json")),
});

var result = await ads.RequestAsync("plc_pub_…", new AdContext { Category = "technology" });
if (result.HasAd)
{
    // Render result.Ad (text values are plain text; always show result.Ad.Disclosure), then:
    await ads.DidRenderAsync(result.Ad);                      // impression (once per delivery)
    // after ≥ 1 s on screen:  await ads.TrackAsync(result.Ad, AdEvent.Viewable);
    // on click: open ads.ClickUrl(result.Ad) in the system browser
}
else if (result.Fallback == FallbackBehavior.KeepSpace) { /* keep the reserved box empty */ }
else { /* collapse the placement */ }
```

Avalonia:

```csharp
using HCG.Ads.Avalonia;
panel.Children.Add(new HCGAdView(ads, "plc_pub_…", mediaHttp: new HttpClient()));
```

`HCGAdView` requests on attach, renders an `HCGAdCard`, records the impression, records viewable after one second
on screen, opens the click URL through the top level's launcher, and collapses (or keeps its space) when there is no
ad or anything fails.

## Behaviour

- **Never throws to the host.** Network errors, timeouts (enforced even if a handler ignores cancellation), invalid
  JSON and an unknown `contractVersion` all return an empty `AdResult` with a reason.
- **No response caching.** Each request is a new delivery.
- **Consent.** Without measurement consent no beacons are sent and click URLs get `?m=0`. Without storage consent
  frequency counters stay in memory; withdrawing storage consent deletes the file.
- **Frequency limits** stay on the device; only capped campaign ids are sent as `exclude`.
- **Beacons** are sent once per delivery and event type; previews are never measured. Video milestones go to the
  `beacons.video` base with `/video` replaced by `/video_start`, `/video_25`, … .
- **Media** uses the explicit crop (`MediaMath.CropToSource`) or a uniform fit (`MediaMath.AspectFit`); never stretched.

## Verified (25 Nov 2026, .NET SDK 8.0.134, Linux)

- `dotnet build`: 0 warnings, 0 errors (warnings are errors) for `netstandard2.0` and `net8.0`.
- `dotnet test`: `HCGAds.Tests` 15 passed, 1 skipped (live test, opt-in); `HCGAds.Avalonia.Tests` 4 passed.
- The decoding test uses a **real response captured from an HCG ADS server**: an internal article-card
  campaign for a real HCG News article on a `windows` placement.
- **Live test passed** against a local HCG ADS server. The server delivered an ad to the registered app id, one
  impression was recorded (0 invalid), the duplicate was suppressed on the device, and an unregistered app id was
  refused (`app_not_registered`).
- CI: the `dotnet` job of `.github/workflows/native-sdks.yml` runs the same tests on GitHub's Linux runners.

Run the live test yourself (development server on loopback):

```bash
HCG_ADS_LIVE_ENDPOINT=http://127.0.0.1:7800 HCG_ADS_LIVE_PLACEMENT=plc_pub_… HCG_ADS_LIVE_APP_ID=<registered app id> dotnet test sdk/dotnet
```

Not verified: the Avalonia control on a real Windows/macOS desktop (only headless), and video playback (the
Avalonia control renders image and native creatives; video creatives show their text card).
