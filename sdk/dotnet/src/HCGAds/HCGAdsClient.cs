using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace HCG.Ads
{
    /// <summary>Measurement events. Video milestones go to the delivery's video beacon base.</summary>
    public enum AdEvent { Impression, Viewable, VideoStart, Video25, Video50, Video75, VideoComplete, Error }

    public sealed class HCGAdsOptions
    {
        /// <summary>Base URL of HCG ADS (e.g. https://ads.hakmicapitalgroup.com). No keys are needed or accepted.</summary>
        public Uri Endpoint { get; set; } = new Uri("http://127.0.0.1:7800");
        /// <summary>Registered application id, sent as X-HCG-App-Id (the publisher must list it).</summary>
        public string? AppId { get; set; }
        /// <summary>windows | macos | linux | desktop</summary>
        public string Platform { get; set; } = "windows";
        public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(3);
        public Consent Consent { get; set; } = Consent.Default;
        /// <summary>Frequency counters; defaults to memory only. Use a file-backed store for persistence (needs storage consent).</summary>
        public IFrequencyStore? Frequency { get; set; }
        public Func<DateTimeOffset> Clock { get; set; } = () => DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// HCG ADS delivery client (contract v1). Requests never throw to the caller: every failure becomes an
    /// empty <see cref="AdResult"/> so the host application keeps working. Responses are not cached; each
    /// request is a new delivery.
    /// </summary>
    public sealed class HCGAdsClient
    {
        public const string SdkName = "hcg-ads-dotnet";
        public const string SdkVersion = "0.1.0";

        internal static readonly JsonSerializerOptions Json = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = false,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        private readonly HttpClient _http;
        private readonly HCGAdsOptions _options;
        private readonly object _lock = new object();
        private readonly HashSet<string> _sent = new HashSet<string>();
        private Consent _consent;

        public HCGAdsClient(HttpClient http, HCGAdsOptions options)
        {
            _http = http ?? throw new ArgumentNullException(nameof(http));
            _options = options ?? throw new ArgumentNullException(nameof(options));
            _consent = options.Consent;
            Frequency = options.Frequency ?? new FrequencyStore(null, false);
            Frequency.SetPersistent(_consent.Storage);
        }

        public IFrequencyStore Frequency { get; }
        public Consent Consent { get { lock (_lock) return _consent; } }

        public void SetConsent(Consent consent)
        {
            lock (_lock) _consent = consent ?? throw new ArgumentNullException(nameof(consent));
            Frequency.SetPersistent(consent.Storage);
        }

        /// <summary>Requests an ad for a placement public key.</summary>
        public async Task<AdResult> RequestAsync(string placement, AdContext? context = null, string device = "desktop", CancellationToken cancellationToken = default)
        {
            try
            {
                var body = new DeliveryRequest
                {
                    Placement = placement,
                    Platform = _options.Platform,
                    Device = device,
                    Context = context,
                    Consent = Consent,
                    Exclude = Frequency.Capped(_options.Clock()).ToList(),
                    Sdk = new SdkInfo { Name = SdkName, Version = SdkVersion },
                };
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(_options.Endpoint, "delivery/v1/ad"))
                {
                    Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json"),
                };
                if (!string.IsNullOrEmpty(_options.AppId)) request.Headers.TryAddWithoutValidation("X-HCG-App-Id", _options.AppId);
                var text = await WithDeadline(async token =>
                {
                    using var response = await _http.SendAsync(request, token).ConfigureAwait(false);
                    return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                }, cancellationToken).ConfigureAwait(false);
                return Interpret(text);
            }
            catch (Exception e) when (e is HttpRequestException || e is OperationCanceledException || e is InvalidOperationException || e is UriFormatException)
            {
                return AdResult.Empty("network_error");
            }
        }

        /// <summary>Decodes a delivery response; an unknown contract version is treated as empty.</summary>
        public static AdResult Interpret(string json)
        {
            DeliveryResponse? response;
            try { response = JsonSerializer.Deserialize<DeliveryResponse>(json, Json); }
            catch (JsonException) { return AdResult.Empty("invalid_response"); }
            catch (NotSupportedException) { return AdResult.Empty("invalid_response"); }
            if (response == null) return AdResult.Empty("invalid_response");
            if (response.ContractVersion != HCGAdsContract.Version) return AdResult.Empty("unsupported_contract_version", response.Placement);
            if (response.Ad == null) return AdResult.Empty(response.Reason ?? "no_ad", response.Placement);
            return AdResult.WithAd(response.Ad, response.Placement);
        }

        /// <summary>Call when the ad is on screen: records frequency and the impression (once).</summary>
        public Task<bool> DidRenderAsync(RenderableAd ad, CancellationToken cancellationToken = default)
        {
            Frequency.Record(ad.CampaignId, ad.Frequency, _options.Clock());
            return TrackAsync(ad, AdEvent.Impression, cancellationToken);
        }

        /// <summary>
        /// Sends one event per delivery and type, only with measurement consent and never for previews.
        /// Returns whether a beacon was sent. Failures are swallowed.
        /// </summary>
        public async Task<bool> TrackAsync(RenderableAd ad, AdEvent type, CancellationToken cancellationToken = default)
        {
            if (!Consent.Measurement || ad.Preview) return false;
            var key = ad.DeliveryId + ":" + EventName(type);
            lock (_lock) { if (!_sent.Add(key)) return false; }
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, BeaconUrl(ad, type));
                if (!string.IsNullOrEmpty(_options.AppId)) request.Headers.TryAddWithoutValidation("X-HCG-App-Id", _options.AppId);
                await WithDeadline(async token =>
                {
                    using var response = await _http.SendAsync(request, token).ConfigureAwait(false);
                    return true;
                }, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (e is HttpRequestException || e is OperationCanceledException || e is InvalidOperationException || e is UriFormatException) { }
            return true;
        }

        /// <summary>
        /// Runs <paramref name="work"/> with the configured timeout. The deadline holds even if the HTTP
        /// handler ignores cancellation: the caller gets <see cref="OperationCanceledException"/> on time and the
        /// abandoned work's eventual exception is observed.
        /// </summary>
        private async Task<T> WithDeadline<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(_options.Timeout);
            var task = work(cts.Token);
            var deadline = Task.Delay(_options.Timeout, cancellationToken);
            if (await Task.WhenAny(task, deadline).ConfigureAwait(false) != task)
            {
                cts.Cancel();
                _ = task.ContinueWith(t => _ = t.Exception, TaskScheduler.Default);
                throw new OperationCanceledException("HCG ADS request timed out");
            }
            return await task.ConfigureAwait(false);
        }

        /// <summary>
        /// The URL to open for a click. The server records the click (unless measurement is withheld,
        /// <c>m=0</c>) and redirects to the validated destination.
        /// </summary>
        public string ClickUrl(RenderableAd ad)
        {
            if (Consent.Measurement) return ad.ClickUrl;
            return ad.ClickUrl + (ad.ClickUrl.Contains("?") ? "&" : "?") + "m=0";
        }

        public static string EventName(AdEvent type) => type switch
        {
            AdEvent.Impression => "impression",
            AdEvent.Viewable => "viewable",
            AdEvent.VideoStart => "video_start",
            AdEvent.Video25 => "video_25",
            AdEvent.Video50 => "video_50",
            AdEvent.Video75 => "video_75",
            AdEvent.VideoComplete => "video_complete",
            _ => "error",
        };

        /// <summary>Beacon URL: impression and viewable as given; others replace the video base's trailing "/video".</summary>
        public static string BeaconUrl(RenderableAd ad, AdEvent type)
        {
            switch (type)
            {
                case AdEvent.Impression: return ad.Beacons.Impression;
                case AdEvent.Viewable: return ad.Beacons.Viewable;
                default:
                    var video = ad.Beacons.Video;
                    var cut = video.EndsWith("/video", StringComparison.Ordinal) ? video.Substring(0, video.Length - "/video".Length) : video.TrimEnd('/');
                    return cut + "/" + EventName(type);
            }
        }
    }
}
