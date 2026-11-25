using System.Net;
using System.Text;
using System.Text.Json;
using HCG.Ads;
using Xunit;

namespace HCG.Ads.Tests;

/// <summary>Records requests and answers with a fixed body (or throws).</summary>
internal sealed class FakeHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _respond;
    public List<(HttpRequestMessage Request, string? Body)> Requests { get; } = new();
    public FakeHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) => _respond = respond;
    public static FakeHandler Returning(string json) => new(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") }));
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content == null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request, body));
        return await _respond(request);
    }
}

public class ClientTests
{
    /// <summary>A real response captured from an HCG ADS server (internal article-card campaign, Windows desktop placement).</summary>
    private static readonly string Real = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "real-delivery-response.json"));

    private static HCGAdsClient Client(FakeHandler handler, Consent? consent = null, IFrequencyStore? frequency = null) =>
        new(new HttpClient(handler), new HCGAdsOptions { Endpoint = new Uri("https://ads.example/"), AppId = "com.example.windows", Consent = consent ?? Consent.Default, Frequency = frequency });

    [Fact]
    public void DecodesARealServerResponse()
    {
        var result = HCGAdsClient.Interpret(Real);
        Assert.True(result.HasAd);
        var ad = result.Ad!;
        Assert.Equal("article-card", ad.Type);
        Assert.Equal("Promoted by HCG", ad.Disclosure);
        Assert.Equal("Hakmi Capital Group", ad.SponsorName);
        Assert.Equal("Read on HCG News", ad.CallToAction);
        Assert.StartsWith("http://127.0.0.1:7803/delivery/v1/click/", ad.ClickUrl);
        Assert.EndsWith("/impression", ad.Beacons.Impression);
        Assert.False(ad.Preview);
        Assert.Equal("responsive-native", result.Placement!.Responsive);
        Assert.Equal("collapse", result.Placement.Fallback);
        Assert.False(result.Placement.IsHorizontal);
    }

    [Fact]
    public void UnknownContractVersionOrGarbageIsEmpty()
    {
        var v2 = Real.Replace("\"contractVersion\":\"1\"", "\"contractVersion\":\"2\"");
        var r = HCGAdsClient.Interpret(v2);
        Assert.False(r.HasAd);
        Assert.Equal("unsupported_contract_version", r.Reason);
        Assert.Equal("invalid_response", HCGAdsClient.Interpret("not json").Reason);
        Assert.Equal("invalid_response", HCGAdsClient.Interpret("null").Reason);
        Assert.Equal("no_eligible_campaign", HCGAdsClient.Interpret("{\"contractVersion\":\"1\",\"placement\":null,\"ad\":null,\"reason\":\"no_eligible_campaign\"}").Reason);
    }

    [Fact]
    public void UnknownFieldsAreIgnored()
    {
        var withExtra = Real.Replace("\"contractVersion\":\"1\",", "\"contractVersion\":\"1\",\"futureField\":{\"x\":1},");
        Assert.True(HCGAdsClient.Interpret(withExtra).HasAd);
    }

    [Fact]
    public async Task NetworkFailureAndTimeoutNeverThrow()
    {
        var failing = new FakeHandler(_ => throw new HttpRequestException("offline"));
        var r = await Client(failing).RequestAsync("plc_pub_x");
        Assert.False(r.HasAd);
        Assert.Equal("network_error", r.Reason);
        Assert.Equal(FallbackBehavior.Collapse, r.Fallback);

        var slow = new FakeHandler(async _ => { await Task.Delay(TimeSpan.FromSeconds(10)); return new HttpResponseMessage(HttpStatusCode.OK); });
        var client = new HCGAdsClient(new HttpClient(slow), new HCGAdsOptions { Endpoint = new Uri("https://ads.example/"), Timeout = TimeSpan.FromMilliseconds(100) });
        var started = DateTime.UtcNow;
        Assert.Equal("network_error", (await client.RequestAsync("plc_pub_x")).Reason);
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void KeepSpaceFallbackIsReported()
    {
        var r = HCGAdsClient.Interpret("{\"contractVersion\":\"1\",\"placement\":{\"id\":\"p\",\"width\":300,\"height\":250,\"responsive\":\"fixed\",\"fallback\":\"keep-space\"},\"ad\":null,\"reason\":\"no_eligible_campaign\"}");
        Assert.Equal(FallbackBehavior.KeepSpace, r.Fallback);
        var h = HCGAdsClient.Interpret("{\"contractVersion\":\"1\",\"placement\":{\"id\":\"p\",\"width\":728,\"height\":90,\"responsive\":\"fluid-width\",\"fallback\":\"house-ad\"},\"ad\":null}");
        Assert.Equal(FallbackBehavior.Collapse, h.Fallback); // house-ad is decided by the server
        Assert.True(h.Placement!.IsHorizontal);
    }

    [Fact]
    public async Task RequestSendsContractBodyAppIdAndFrequencyExclusions()
    {
        var withCap = Real.Replace("\"frequency\":null", "\"frequency\":{\"count\":1,\"windowHours\":24}");
        var handler = FakeHandler.Returning(withCap);
        var client = Client(handler);
        var first = await client.RequestAsync("plc_pub_x", new AdContext { Category = "technology" });
        Assert.True(first.HasAd);
        await client.DidRenderAsync(first.Ad!);
        await client.RequestAsync("plc_pub_x");

        var adCalls = handler.Requests.Where(r => r.Request.RequestUri!.AbsolutePath == "/delivery/v1/ad").ToList();
        Assert.Equal(2, adCalls.Count);
        Assert.Equal("com.example.windows", adCalls[1].Request.Headers.GetValues("X-HCG-App-Id").Single());
        using var doc = JsonDocument.Parse(adCalls[1].Body!);
        Assert.Equal("plc_pub_x", doc.RootElement.GetProperty("placement").GetString());
        Assert.Equal("windows", doc.RootElement.GetProperty("platform").GetString());
        Assert.Equal("hcg-ads-dotnet", doc.RootElement.GetProperty("sdk").GetProperty("name").GetString());
        Assert.Equal(first.Ad!.CampaignId, doc.RootElement.GetProperty("exclude")[0].GetString());
        Assert.False(doc.RootElement.GetProperty("consent").GetProperty("storage").GetBoolean());
        using var firstDoc = JsonDocument.Parse(adCalls[0].Body!);
        Assert.Equal("technology", firstDoc.RootElement.GetProperty("context").GetProperty("category").GetString());
    }

    [Fact]
    public async Task BeaconsAreSentOncePerDeliveryAndTypeWithMilestoneUrls()
    {
        var handler = FakeHandler.Returning("{\"counted\":true}");
        var client = Client(handler);
        var ad = HCGAdsClient.Interpret(Real).Ad!;
        Assert.True(await client.TrackAsync(ad, AdEvent.Impression));
        Assert.False(await client.TrackAsync(ad, AdEvent.Impression));
        Assert.True(await client.TrackAsync(ad, AdEvent.Video25));
        Assert.False(await client.TrackAsync(ad, AdEvent.Video25));
        var paths = handler.Requests.Select(r => r.Request.RequestUri!.AbsolutePath.Split('/').Last()).ToList();
        Assert.Equal(new[] { "impression", "video_25" }, paths);
        Assert.EndsWith("/video_complete", HCGAdsClient.BeaconUrl(ad, AdEvent.VideoComplete));
        Assert.DoesNotContain("/video/", HCGAdsClient.BeaconUrl(ad, AdEvent.VideoStart));
    }

    [Fact]
    public async Task WithoutMeasurementConsentNothingIsMeasuredAndClicksCarryM0()
    {
        var handler = FakeHandler.Returning("{}");
        var client = Client(handler, Consent.None);
        var ad = HCGAdsClient.Interpret(Real).Ad!;
        Assert.False(await client.TrackAsync(ad, AdEvent.Impression));
        Assert.Empty(handler.Requests);
        Assert.EndsWith("?m=0", client.ClickUrl(ad));
        client.SetConsent(Consent.Default);
        Assert.Equal(ad.ClickUrl, client.ClickUrl(ad));
    }

    [Fact]
    public async Task PreviewsAreNeverMeasured()
    {
        var handler = FakeHandler.Returning("{}");
        var ad = HCGAdsClient.Interpret(Real.Replace("\"preview\":false", "\"preview\":true")).Ad!;
        Assert.False(await Client(handler).TrackAsync(ad, AdEvent.Impression));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public void AdTextIsPlainText()
    {
        var hostile = Real.Replace("\"headline\":\"", "\"headline\":\"<script>alert(1)</script>");
        var ad = HCGAdsClient.Interpret(hostile).Ad!;
        Assert.StartsWith("<script>", ad.Headline); // delivered verbatim as text; renderers must not interpret it
    }
}
