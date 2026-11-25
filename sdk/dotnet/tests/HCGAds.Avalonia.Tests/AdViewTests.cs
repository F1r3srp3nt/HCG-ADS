using System.Net;
using System.Text;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.LogicalTree;
using HCG.Ads;
using HCG.Ads.Avalonia;
using Xunit;

[assembly: AvaloniaTestApplication(typeof(HCG.Ads.Avalonia.Tests.TestAppBuilder))]

namespace HCG.Ads.Avalonia.Tests;

public class TestApp : Application { }

public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<TestApp>().UseHeadless(new AvaloniaHeadlessPlatformOptions());
}

internal sealed class StubHandler : HttpMessageHandler
{
    private readonly string _body;
    public int Calls;
    public StubHandler(string body) => _body = body;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Calls);
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(_body, Encoding.UTF8, "application/json") });
    }
}

public class AdViewTests
{
    private static readonly string Real = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "real-delivery-response.json"));

    private static string TextOf(Control root, string name) =>
        root.GetLogicalDescendants().OfType<TextBlock>().FirstOrDefault(t => t.Name == name)?.Text ?? "";

    [AvaloniaFact]
    public async Task RendersTheAdWithAVisibleDisclosureAsPlainText()
    {
        var hostile = Real.Replace("\"headline\":\"", "\"headline\":\"<b>bold?</b> ");
        var client = new HCGAdsClient(new HttpClient(new StubHandler(hostile)), new HCGAdsOptions { Endpoint = new Uri("https://ads.example/") });
        var view = new HCGAdView(client, "plc_pub_x");
        var window = new Window { Content = view };
        window.Show();
        await view.LoadAsync();

        Assert.True(view.IsVisible);
        var card = Assert.IsType<HCGAdCard>(view.Content);
        Assert.Equal("Promoted by HCG", TextOf(card, "Disclosure"));
        Assert.StartsWith("<b>bold?</b> ", TextOf(card, "Headline")); // shown literally, never parsed
        Assert.Equal("Hakmi Capital Group", TextOf(card, "Sponsor"));
        var disclosure = card.GetLogicalDescendants().OfType<TextBlock>().First(t => t.Name == "Disclosure");
        Assert.True(disclosure.IsEffectivelyVisible);
        window.Close();
    }

    [AvaloniaFact]
    public async Task CollapsesWhenThereIsNoAdAndKeepsSpaceWhenAsked()
    {
        var empty = "{\"contractVersion\":\"1\",\"placement\":{\"id\":\"p\",\"width\":300,\"height\":250,\"responsive\":\"fixed\",\"fallback\":\"collapse\"},\"ad\":null,\"reason\":\"no_eligible_campaign\"}";
        var view = new HCGAdView(new HCGAdsClient(new HttpClient(new StubHandler(empty)), new HCGAdsOptions { Endpoint = new Uri("https://ads.example/") }), "p");
        await view.LoadAsync();
        Assert.False(view.IsVisible);
        Assert.Null(view.Content);

        var keep = empty.Replace("\"collapse\"", "\"keep-space\"");
        var kept = new HCGAdView(new HCGAdsClient(new HttpClient(new StubHandler(keep)), new HCGAdsOptions { Endpoint = new Uri("https://ads.example/") }), "p");
        await kept.LoadAsync();
        Assert.True(kept.IsVisible);
        Assert.Equal(250, kept.Height);
    }

    [AvaloniaFact]
    public async Task ClickUsesTheTrackedUrlWithoutMeasurementConsentFlag()
    {
        var client = new HCGAdsClient(new HttpClient(new StubHandler(Real)), new HCGAdsOptions { Endpoint = new Uri("https://ads.example/"), Consent = Consent.None });
        var view = new HCGAdView(client, "p");
        string? opened = null;
        view.Opening += (_, url) => opened = url;
        await view.LoadAsync();
        var card = Assert.IsType<HCGAdCard>(view.Content);
        card.CallToAction.RaiseEvent(new global::Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.NotNull(opened);
        Assert.Contains("/delivery/v1/click/", opened);
        Assert.EndsWith("?m=0", opened);
    }

    [AvaloniaFact]
    public void FixedPlacementsGetTheirExactSize()
    {
        var ad = HCGAdsClient.Interpret(Real).Ad!;
        var card = new HCGAdCard(ad, new PlacementInfo { Id = "p", Width = 300, Height = 250, Responsive = "fixed" });
        Assert.Equal(300, card.Width);
        Assert.Equal(250, card.Height);
        var native = new HCGAdCard(ad, new PlacementInfo { Id = "n", Responsive = "responsive-native" });
        Assert.True(double.IsNaN(native.Width));
    }
}
