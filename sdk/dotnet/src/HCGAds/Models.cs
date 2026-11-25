using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace HCG.Ads
{
    /// <summary>HCG ADS public delivery contract, version 1 (mirrors packages/contracts in the HCG ADS repository).</summary>
    public static class HCGAdsContract
    {
        public const string Version = "1";
    }

    /// <summary>What the person agreed to. Without <see cref="Storage"/>, nothing is persisted on the device.</summary>
    public sealed class Consent
    {
        public Consent(bool storage, bool measurement) { Storage = storage; Measurement = measurement; }
        [JsonPropertyName("storage")] public bool Storage { get; }
        [JsonPropertyName("measurement")] public bool Measurement { get; }
        /// <summary>Aggregate measurement only; nothing stored on the device.</summary>
        public static Consent Default { get; } = new Consent(false, true);
        public static Consent None { get; } = new Consent(false, false);
    }

    /// <summary>Normalised crop rectangle (0..1). Cropping is explicit; media is never stretched.</summary>
    public sealed class CropRect
    {
        [JsonPropertyName("x")] public double X { get; set; }
        [JsonPropertyName("y")] public double Y { get; set; }
        [JsonPropertyName("width")] public double Width { get; set; }
        [JsonPropertyName("height")] public double Height { get; set; }
    }

    public sealed class AdContext
    {
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("keywords")] public List<string>? Keywords { get; set; }
        [JsonPropertyName("path")] public string? Path { get; set; }
    }

    public sealed class SdkInfo
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("version")] public string Version { get; set; } = "";
    }

    public sealed class DeliveryRequest
    {
        [JsonPropertyName("placement")] public string Placement { get; set; } = "";
        [JsonPropertyName("platform")] public string? Platform { get; set; }
        /// <summary>any | desktop | tablet | mobile</summary>
        [JsonPropertyName("device")] public string? Device { get; set; }
        [JsonPropertyName("context")] public AdContext? Context { get; set; }
        [JsonPropertyName("consent")] public Consent? Consent { get; set; }
        [JsonPropertyName("exclude")] public List<string>? Exclude { get; set; }
        [JsonPropertyName("sdk")] public SdkInfo? Sdk { get; set; }
    }

    public sealed class AdMedia
    {
        /// <summary>image | animated-image | video | native</summary>
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("url")] public string Url { get; set; } = "";
        [JsonPropertyName("width")] public int? Width { get; set; }
        [JsonPropertyName("height")] public int? Height { get; set; }
        [JsonPropertyName("mime")] public string? Mime { get; set; }
        [JsonPropertyName("posterUrl")] public string? PosterUrl { get; set; }
        [JsonPropertyName("crop")] public CropRect? Crop { get; set; }
        [JsonPropertyName("alt")] public string? Alt { get; set; }
    }

    public sealed class FrequencyRule
    {
        [JsonPropertyName("count")] public int Count { get; set; }
        [JsonPropertyName("windowHours")] public double WindowHours { get; set; }
    }

    public sealed class Beacons
    {
        [JsonPropertyName("impression")] public string Impression { get; set; } = "";
        [JsonPropertyName("viewable")] public string Viewable { get; set; } = "";
        [JsonPropertyName("video")] public string Video { get; set; } = "";
    }

    /// <summary>An advertisement to render. All text values are plain text: never interpret them as markup.</summary>
    public sealed class RenderableAd
    {
        [JsonPropertyName("deliveryId")] public string DeliveryId { get; set; } = "";
        [JsonPropertyName("campaignId")] public string CampaignId { get; set; } = "";
        [JsonPropertyName("creativeId")] public string CreativeId { get; set; } = "";
        /// <summary>article-card | image | video | native-text</summary>
        [JsonPropertyName("type")] public string Type { get; set; } = "";
        [JsonPropertyName("headline")] public string Headline { get; set; } = "";
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("callToAction")] public string CallToAction { get; set; } = "";
        [JsonPropertyName("clickUrl")] public string ClickUrl { get; set; } = "";
        [JsonPropertyName("displayUrl")] public string DisplayUrl { get; set; } = "";
        /// <summary>Must always be shown with the ad (e.g. "Sponsored", "Promoted by HCG").</summary>
        [JsonPropertyName("disclosure")] public string Disclosure { get; set; } = "";
        [JsonPropertyName("sponsorName")] public string SponsorName { get; set; } = "";
        [JsonPropertyName("media")] public AdMedia? Media { get; set; }
        [JsonPropertyName("frequency")] public FrequencyRule? Frequency { get; set; }
        [JsonPropertyName("beacons")] public Beacons Beacons { get; set; } = new Beacons();
        [JsonPropertyName("preview")] public bool Preview { get; set; }
    }

    public sealed class PlacementInfo
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("width")] public int? Width { get; set; }
        [JsonPropertyName("height")] public int? Height { get; set; }
        /// <summary>fixed | fluid-width | responsive-native</summary>
        [JsonPropertyName("responsive")] public string Responsive { get; set; } = "";
        /// <summary>collapse | house-ad | keep-space</summary>
        [JsonPropertyName("fallback")] public string Fallback { get; set; } = "collapse";

        /// <summary>Wide fixed placements (e.g. 728×90, 320×50) use a horizontal card.</summary>
        [JsonIgnore]
        public bool IsHorizontal => Responsive != "responsive-native" && Width is int w && Height is int h && h > 0 && (double)w / h > 2.5;
    }

    public sealed class DeliveryResponse
    {
        [JsonPropertyName("contractVersion")] public string ContractVersion { get; set; } = "";
        [JsonPropertyName("placement")] public PlacementInfo? Placement { get; set; }
        [JsonPropertyName("ad")] public RenderableAd? Ad { get; set; }
        [JsonPropertyName("reason")] public string? Reason { get; set; }
    }

    /// <summary>What a placement should do when there is no ad.</summary>
    public enum FallbackBehavior { Collapse, KeepSpace, HouseAd }

    /// <summary>Outcome of a placement request. Never an error the host has to handle.</summary>
    public sealed class AdResult
    {
        private AdResult(RenderableAd? ad, PlacementInfo? placement, string? reason)
        {
            Ad = ad; Placement = placement; Reason = reason;
        }

        public RenderableAd? Ad { get; }
        public PlacementInfo? Placement { get; }
        /// <summary>Why nothing is shown (diagnostics only).</summary>
        public string? Reason { get; }
        public bool HasAd => Ad != null;

        /// <summary>
        /// Fallback for an empty result: collapse (hide the placement) unless the placement asks to keep its space.
        /// house-ad is decided by the server; when it still returns nothing the placement collapses.
        /// </summary>
        public FallbackBehavior Fallback => Placement?.Fallback == "keep-space" ? FallbackBehavior.KeepSpace : FallbackBehavior.Collapse;

        public static AdResult WithAd(RenderableAd ad, PlacementInfo? placement) => new AdResult(ad, placement, null);
        public static AdResult Empty(string reason, PlacementInfo? placement = null) => new AdResult(null, placement, reason);
    }
}
