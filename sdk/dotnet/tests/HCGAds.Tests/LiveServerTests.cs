using System.Text.Json;
using HCG.Ads;
using Xunit;

namespace HCG.Ads.Tests;

/// <summary>Runs only when HCG_ADS_LIVE_ENDPOINT (and HCG_ADS_LIVE_PLACEMENT, HCG_ADS_LIVE_APP_ID) are set.</summary>
public sealed class LiveFactAttribute : FactAttribute
{
    public LiveFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("HCG_ADS_LIVE_ENDPOINT")))
            Skip = "Set HCG_ADS_LIVE_ENDPOINT, HCG_ADS_LIVE_PLACEMENT and HCG_ADS_LIVE_APP_ID to run against a local HCG ADS server.";
    }
}

public class LiveServerTests
{
    [LiveFact]
    public async Task RequestsAnAdAndRecordsAnImpressionOnARealServer()
    {
        var endpoint = new Uri(Environment.GetEnvironmentVariable("HCG_ADS_LIVE_ENDPOINT")!.TrimEnd('/') + "/");
        var placement = Environment.GetEnvironmentVariable("HCG_ADS_LIVE_PLACEMENT")!;
        var appId = Environment.GetEnvironmentVariable("HCG_ADS_LIVE_APP_ID")!;
        using var http = new HttpClient();
        var client = new HCGAdsClient(http, new HCGAdsOptions { Endpoint = endpoint, AppId = appId, Platform = "windows", Timeout = TimeSpan.FromSeconds(10) });

        var result = await client.RequestAsync(placement, device: "desktop");
        Assert.True(result.HasAd, "no ad: " + result.Reason);
        var ad = result.Ad!;
        Assert.False(string.IsNullOrEmpty(ad.Disclosure));

        async Task<int> Impressions()
        {
            // Development identity only (loopback server); production administration needs HCG Connect.
            var json = await http.GetStringAsync(new Uri(endpoint, "admin/v1/analytics?campaignId=" + Uri.EscapeDataString(ad.CampaignId)));
            return JsonDocument.Parse(json).RootElement.GetProperty("totals").GetProperty("impressions").GetInt32();
        }
        var before = await Impressions();
        Assert.True(await client.DidRenderAsync(ad));
        Assert.False(await client.TrackAsync(ad, AdEvent.Impression)); // deduplicated on the device
        Assert.Equal(before + 1, await Impressions());

        // Without the registered app id, the server refuses delivery.
        var stranger = new HCGAdsClient(http, new HCGAdsOptions { Endpoint = endpoint, AppId = "com.example.unregistered", Platform = "windows" });
        var refused = await stranger.RequestAsync(placement);
        Assert.False(refused.HasAd);
        Assert.Equal("app_not_registered", refused.Reason);
    }
}
