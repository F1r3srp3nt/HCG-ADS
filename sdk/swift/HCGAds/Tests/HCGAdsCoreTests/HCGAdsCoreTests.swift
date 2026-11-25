import XCTest
@testable import HCGAdsCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class RecordingTransport: HCGAdsTransport, @unchecked Sendable {
    let body: Data
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return _requests }
    init(body: Data) { self.body = body }
    func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        lock.lock(); _requests.append(request); lock.unlock()
        return (body, URLResponse(url: request.url!, mimeType: "application/json", expectedContentLength: body.count, textEncodingName: nil))
    }
}

let sample = """
{"contractVersion":"1","placement":{"id":"plc_1","width":300,"height":250,"responsive":"fixed","fallback":"collapse"},
 "ad":{"deliveryId":"d1","campaignId":"cmp_1","creativeId":"crv_1","type":"article-card","headline":"Headline","description":null,
 "callToAction":"Read","clickUrl":"https://ads.example/delivery/v1/click/tok","displayUrl":"news.hakmicapitalgroup.com",
 "disclosure":"Promoted by HCG","sponsorName":"Hakmi Capital Group",
 "media":{"kind":"image","url":"https://img.example/a.png","width":1200,"height":675,"mime":"image/png","posterUrl":null,"crop":{"x":0,"y":0.1,"width":1,"height":0.8},"alt":"Cover"},
 "frequency":{"count":1,"windowHours":24},
 "beacons":{"impression":"https://ads.example/delivery/v1/events/tok/impression","viewable":"https://ads.example/delivery/v1/events/tok/viewable","video":"https://ads.example/delivery/v1/events/tok/video"},
 "preview":false}}
""".data(using: .utf8)!

final class HCGAdsCoreTests: XCTestCase {
    func testDecodesContractV1() {
        guard case let .ad(ad, placement) = HCGAdsClient.interpret(sample) else { return XCTFail("expected ad") }
        XCTAssertEqual(ad.disclosure, "Promoted by HCG")
        XCTAssertEqual(ad.type, .articleCard)
        XCTAssertEqual(ad.media?.crop?.height, 0.8)
        XCTAssertEqual(placement?.fallback, .collapse)
        XCTAssertFalse(placement!.isHorizontal)
    }

    func testUnknownContractVersionIsEmpty() {
        let v2 = String(data: sample, encoding: .utf8)!.replacingOccurrences(of: "\"contractVersion\":\"1\"", with: "\"contractVersion\":\"2\"").data(using: .utf8)!
        XCTAssertEqual(HCGAdsClient.interpret(v2).ad, nil)
        XCTAssertNil(HCGAdsClient.interpret(Data("not json".utf8)).ad)
    }

    func testBeaconsAreSentOncePerDelivery() async {
        let t = RecordingTransport(body: sample)
        let client = HCGAdsClient(configuration: .init(endpoint: URL(string: "https://ads.example")!, appId: "com.example.app"), transport: t, defaults: nil)
        guard let ad = HCGAdsClient.interpret(sample).ad else { return XCTFail() }
        let first = await client.track(ad, .impression)
        let second = await client.track(ad, .impression)
        let video = await client.track(ad, .video25)
        XCTAssertTrue(first)
        XCTAssertFalse(second)
        XCTAssertTrue(video)
        XCTAssertEqual(t.requests.map { $0.url!.lastPathComponent }, ["impression", "video_25"])
        XCTAssertEqual(t.requests.first?.value(forHTTPHeaderField: "X-HCG-App-Id"), "com.example.app")
    }

    func testNoBeaconsWithoutMeasurementConsent() async {
        let t = RecordingTransport(body: sample)
        let client = HCGAdsClient(configuration: .init(endpoint: URL(string: "https://ads.example")!), consent: .none, transport: t, defaults: nil)
        let ad = HCGAdsClient.interpret(sample).ad!
        let sent = await client.track(ad, .impression)
        XCTAssertFalse(sent)
        let click = await client.clickURL(for: ad)
        XCTAssertEqual(click.absoluteString, "https://ads.example/delivery/v1/click/tok?m=0")
    }

    func testFrequencyCapsAndPrunes() {
        let f = FrequencyStore(defaults: nil, persistent: false)
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        f.record(campaignId: "cmp_a", rule: FrequencyRule(count: 2, windowHours: 1), now: t0)
        XCTAssertEqual(f.capped(now: t0), [])
        f.record(campaignId: "cmp_a", rule: FrequencyRule(count: 2, windowHours: 1), now: t0.addingTimeInterval(1))
        XCTAssertEqual(f.capped(now: t0.addingTimeInterval(2)), ["cmp_a"])
        XCTAssertEqual(f.capped(now: t0.addingTimeInterval(3602)), [])
    }

    func testFrequencyPersistsOnlyWithStorageConsent() {
        let defaults = UserDefaults(suiteName: "hcg-ads-tests-\(UUID().uuidString)")!
        let f = FrequencyStore(defaults: defaults, persistent: false)
        f.record(campaignId: "cmp_a", rule: FrequencyRule(count: 1, windowHours: 24))
        XCTAssertNil(defaults.data(forKey: FrequencyStore.defaultsKey))
        f.setPersistent(true)
        f.record(campaignId: "cmp_b", rule: FrequencyRule(count: 1, windowHours: 24))
        XCTAssertNotNil(defaults.data(forKey: FrequencyStore.defaultsKey))
        f.setPersistent(false)
        XCTAssertNil(defaults.data(forKey: FrequencyStore.defaultsKey))
    }

    func testRequestSendsExcludeAndHeaders() async throws {
        let t = RecordingTransport(body: sample)
        let client = HCGAdsClient(configuration: .init(endpoint: URL(string: "https://ads.example")!, appId: "com.example.app"), transport: t, defaults: nil)
        let first = await client.request(placement: "plc_pub_x")
        await client.didRender(first.ad!)
        _ = await client.request(placement: "plc_pub_x")
        let ads = t.requests.filter { $0.url!.path.hasSuffix("/delivery/v1/ad") }
        XCTAssertEqual(ads.count, 2)
        let body = try JSONDecoder().decode(DeliveryRequest.self, from: ads[1].httpBody!)
        XCTAssertEqual(body.exclude, ["cmp_1"])
        XCTAssertEqual(body.sdk?.name, "hcg-ads-swift")
        XCTAssertEqual(ads[1].value(forHTTPHeaderField: "X-HCG-App-Id"), "com.example.app")
    }
}
