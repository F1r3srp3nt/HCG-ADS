import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Network transport, injectable for tests.
public protocol HCGAdsTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, URLResponse)
}

public struct URLSessionTransport: HCGAdsTransport {
    let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }
    public func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }
}

public struct HCGAdsConfiguration: Sendable {
    /// Base URL of HCG ADS, e.g. https://ads.hakmicapitalgroup.com. No keys are needed or accepted.
    public var endpoint: URL
    /// Registered app id sent as X-HCG-App-Id. Defaults to the bundle identifier.
    public var appId: String?
    public var platform: String
    public var timeout: TimeInterval
    public var debug: Bool

    public init(endpoint: URL, appId: String? = Bundle.main.bundleIdentifier, platform: String = HCGAdsConfiguration.defaultPlatform, timeout: TimeInterval = 3, debug: Bool = false) {
        self.endpoint = endpoint
        self.appId = appId
        self.platform = platform
        self.timeout = timeout
        self.debug = debug
    }

    public static var defaultPlatform: String {
        #if os(iOS)
        return "ios"
        #elseif os(macOS)
        return "macos"
        #else
        return "linux"
        #endif
    }
}

/// HCG ADS client. Requests never throw to the caller: every failure becomes `.empty`.
/// Responses are not cached; each request is a new delivery.
public actor HCGAdsClient {
    public static let sdkName = "hcg-ads-swift"
    public static let sdkVersion = "0.1.0"

    public let configuration: HCGAdsConfiguration
    private let transport: HCGAdsTransport
    public nonisolated let frequency: FrequencyStore
    private var consent: Consent
    private var sent: Set<String> = []

    public init(configuration: HCGAdsConfiguration, consent: Consent = .default, transport: HCGAdsTransport = URLSessionTransport(), defaults: UserDefaults? = .standard) {
        self.configuration = configuration
        self.transport = transport
        self.consent = consent
        self.frequency = FrequencyStore(defaults: defaults, persistent: consent.storage)
    }

    public func currentConsent() -> Consent { consent }

    public func setConsent(_ value: Consent) {
        consent = value
        frequency.setPersistent(value.storage)
    }

    /// Requests an ad for a placement public key.
    public func request(placement: String, context: AdContext? = nil, device: DeviceClass = .mobile) async -> AdResult {
        let body = DeliveryRequest(
            placement: placement,
            platform: configuration.platform,
            device: device,
            context: context,
            consent: consent,
            exclude: frequency.capped(),
            sdk: SDKInfo(name: Self.sdkName, version: Self.sdkVersion),
            preview: nil
        )
        var req = URLRequest(url: configuration.endpoint.appendingPathComponent("delivery/v1/ad"))
        req.httpMethod = "POST"
        req.timeoutInterval = configuration.timeout
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let appId = configuration.appId { req.setValue(appId, forHTTPHeaderField: "X-HCG-App-Id") }
        do {
            req.httpBody = try JSONEncoder().encode(body)
            let (data, _) = try await withTimeout(configuration.timeout) { [transport] in try await transport.send(req) }
            return Self.interpret(data)
        } catch {
            log("request failed: \(error)")
            return .empty(reason: "network_error", fallback: .collapse, placement: nil)
        }
    }

    /// Decodes a delivery response, treating an unknown contract version as empty.
    public static func interpret(_ data: Data) -> AdResult {
        guard let response = try? JSONDecoder().decode(DeliveryResponse.self, from: data) else {
            return .empty(reason: "invalid_response", fallback: .collapse, placement: nil)
        }
        let fallback = response.placement?.fallback ?? .collapse
        guard response.contractVersion == HCGAdsContract.version else {
            return .empty(reason: "unsupported_contract_version", fallback: fallback, placement: response.placement)
        }
        guard let ad = response.ad else {
            return .empty(reason: response.reason ?? "no_ad", fallback: fallback, placement: response.placement)
        }
        return .ad(ad, response.placement)
    }

    /// Call when the ad is on screen. Records frequency and the impression once.
    public func didRender(_ ad: RenderableAd) async {
        frequency.record(campaignId: ad.campaignId, rule: ad.frequency)
        await track(ad, .impression)
    }

    /// Sends one event per delivery and type, only with measurement consent, never for previews.
    @discardableResult
    public func track(_ ad: RenderableAd, _ type: EventType) async -> Bool {
        guard consent.measurement, !ad.preview, type != .click else { return false }
        let key = "\(ad.deliveryId):\(type.rawValue)"
        guard !sent.contains(key) else { return false }
        sent.insert(key)
        var req = URLRequest(url: Self.beaconURL(ad, type))
        req.httpMethod = "POST"
        req.timeoutInterval = configuration.timeout
        if let appId = configuration.appId { req.setValue(appId, forHTTPHeaderField: "X-HCG-App-Id") }
        _ = try? await transport.send(req)
        return true
    }

    /// URL to open for a click. The server records the click (unless measurement is
    /// withheld, `m=0`) and redirects to the validated destination.
    public func clickURL(for ad: RenderableAd) -> URL {
        guard !consent.measurement, var c = URLComponents(url: ad.clickUrl, resolvingAgainstBaseURL: false) else { return ad.clickUrl }
        c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "m", value: "0")]
        return c.url ?? ad.clickUrl
    }

    public static func beaconURL(_ ad: RenderableAd, _ type: EventType) -> URL {
        switch type {
        case .impression: return ad.beacons.impression
        case .viewable: return ad.beacons.viewable
        default: return ad.beacons.video.deletingLastPathComponent().appendingPathComponent(type.rawValue)
        }
    }

    private func log(_ message: String) {
        if configuration.debug { print("[HCG ADS] \(message)") }
    }
}

struct TimeoutError: Error {}

func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ work: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await work() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(seconds, 0.1) * 1_000_000_000))
            throw TimeoutError()
        }
        let result = try await group.next()!
        group.cancelAll()
        return result
    }
}
