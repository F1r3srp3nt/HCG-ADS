using System;
using System.Net.Http;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media.Imaging;
using Avalonia.Threading;

namespace HCG.Ads.Avalonia
{
    /// <summary>
    /// An HCG ADS placement for Avalonia desktop apps. Requests an ad when attached; collapses (or keeps its
    /// space when the placement says so) when there is no ad or anything fails, so the host app is unaffected.
    /// Impression on render, viewable after one continuous second on screen, clicks through <see cref="HCGAdsClient.ClickUrl"/>.
    /// </summary>
    public sealed class HCGAdView : ContentControl
    {
        private DispatcherTimer? _viewable;

        public HCGAdView(HCGAdsClient client, string placement, AdContext? context = null, HttpClient? mediaHttp = null)
        {
            Client = client;
            Placement = placement;
            Context = context;
            MediaHttp = mediaHttp;
            IsVisible = false;
        }

        public HCGAdsClient Client { get; }
        public string Placement { get; }
        public AdContext? Context { get; }
        public HttpClient? MediaHttp { get; }
        public AdResult? Result { get; private set; }

        /// <summary>Fired when the person activates the ad; the default opens the click URL in the system browser.</summary>
        public event EventHandler<string>? Opening;

        protected override async void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
        {
            base.OnAttachedToVisualTree(e);
            try { await LoadAsync().ConfigureAwait(true); }
            catch (Exception) { Collapse(null); } // never let advertising break the host
        }

        protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
        {
            _viewable?.Stop();
            _viewable = null;
            base.OnDetachedFromVisualTree(e);
        }

        public async Task LoadAsync()
        {
            Result = await Client.RequestAsync(Placement, Context, "desktop").ConfigureAwait(true);
            if (!Result.HasAd) { Collapse(Result); return; }
            Show(Result.Ad!, Result.Placement, await LoadImageAsync(Result.Ad!).ConfigureAwait(true));
        }

        /// <summary>Builds the card for an ad (also usable without a network, e.g. previews and tests).</summary>
        public void Show(RenderableAd ad, PlacementInfo? placement, Bitmap? image)
        {
            var card = new HCGAdCard(ad, placement, image);
            card.CallToAction.Click += (_, _) => Activate(ad);
            Content = card;
            IsVisible = true;
            _ = Client.DidRenderAsync(ad);
            _viewable?.Stop();
            _viewable = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _viewable.Tick += (_, _) =>
            {
                _viewable?.Stop();
                if (IsEffectivelyVisible) _ = Client.TrackAsync(ad, AdEvent.Viewable);
            };
            _viewable.Start();
        }

        private void Activate(RenderableAd ad)
        {
            var url = Client.ClickUrl(ad);
            if (Opening != null) { Opening(this, url); return; }
            var launcher = TopLevel.GetTopLevel(this)?.Launcher;
            if (launcher != null && Uri.TryCreate(url, UriKind.Absolute, out var uri)) _ = launcher.LaunchUriAsync(uri);
        }

        private void Collapse(AdResult? result)
        {
            Content = null;
            if (result?.Fallback == FallbackBehavior.KeepSpace && result.Placement?.Height is int h)
            {
                Height = h;
                IsVisible = true;
            }
            else
            {
                IsVisible = false;
            }
        }

        private async Task<Bitmap?> LoadImageAsync(RenderableAd ad)
        {
            if (MediaHttp == null || ad.Media == null || ad.Media.Kind == "video") return null;
            try
            {
                using var stream = await MediaHttp.GetStreamAsync(ad.Media.Url).ConfigureAwait(true);
                return new Bitmap(stream);
            }
            catch (Exception)
            {
                _ = Client.TrackAsync(ad, AdEvent.Error);
                return null; // text-only card
            }
        }
    }
}
