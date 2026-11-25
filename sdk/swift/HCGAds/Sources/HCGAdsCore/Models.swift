import Foundation

/// HCG ADS public delivery contract, version 1 (mirrors packages/contracts in the HCG ADS repository).
public enum HCGAdsContract {
    public static let version = "1"
}

public enum DeviceClass: String, Codable, Sendable { case any, desktop, tablet, mobile }
public enum CreativeType: String, Codable, Sendable { case articleCard = "article-card", image, video, nativeText = "native-text" }
public enum MediaKind: String, Codable, Sendable { case image, animatedImage = "animated-image", video, native }
public enum ResponsiveBehavior: String, Codable, Sendable { case fixed, fluidWidth = "fluid-width", responsiveNative = "responsive-native" }
public enum FallbackBehavior: String, Codable, Sendable { case collapse, houseAd = "house-ad", keepSpace = "keep-space" }

public enum EventType: String, Codable, Sendable, CaseIterable {
    case impression, viewable, click
    case videoStart = "video_start", video25 = "video_25", video50 = "video_50", video75 = "video_75", videoComplete = "video_complete"
    case error
}

/// What the person has agreed to. Without `storage`, nothing is persisted on the device.
public struct Consent: Codable, Equatable, Sendable {
    public var storage: Bool
    public var measurement: Bool
    public init(storage: Bool, measurement: Bool) {
        self.storage = storage
        self.measurement = measurement
    }
    /// Aggregate measurement only, nothing stored on the device.
    public static let `default` = Consent(storage: false, measurement: true)
    public static let none = Consent(storage: false, measurement: false)
}

/// Normalised crop rectangle (0...1). Cropping is explicit; media is never stretched.
public struct CropRect: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
}

public struct AdContext: Codable, Equatable, Sendable {
    public var category: String?
    public var keywords: [String]?
    public var path: String?
    public init(category: String? = nil, keywords: [String]? = nil, path: String? = nil) {
        self.category = category; self.keywords = keywords; self.path = path
    }
}

public struct SDKInfo: Codable, Equatable, Sendable {
    public var name: String
    public var version: String
}

public struct DeliveryRequest: Codable, Equatable, Sendable {
    public var placement: String
    public var platform: String?
    public var device: DeviceClass?
    public var context: AdContext?
    public var consent: Consent?
    public var exclude: [String]?
    public var sdk: SDKInfo?
    public var preview: String?
}

public struct AdMedia: Codable, Equatable, Sendable {
    public var kind: MediaKind
    public var url: URL
    public var width: Int?
    public var height: Int?
    public var mime: String?
    public var posterUrl: URL?
    public var crop: CropRect?
    public var alt: String?
}

public struct FrequencyRule: Codable, Equatable, Sendable {
    public var count: Int
    public var windowHours: Double
    public init(count: Int, windowHours: Double) { self.count = count; self.windowHours = windowHours }
}

public struct Beacons: Codable, Equatable, Sendable {
    public var impression: URL
    public var viewable: URL
    public var video: URL
}

public struct RenderableAd: Codable, Equatable, Sendable, Identifiable {
    public var id: String { deliveryId }
    public var deliveryId: String
    public var campaignId: String
    public var creativeId: String
    public var type: CreativeType
    public var headline: String
    public var description: String?
    public var callToAction: String
    public var clickUrl: URL
    public var displayUrl: String
    public var disclosure: String
    public var sponsorName: String
    public var media: AdMedia?
    public var frequency: FrequencyRule?
    public var beacons: Beacons
    public var preview: Bool
}

public struct PlacementInfo: Codable, Equatable, Sendable {
    public var id: String
    public var width: Int?
    public var height: Int?
    public var responsive: ResponsiveBehavior
    public var fallback: FallbackBehavior

    /// Wide fixed placements (e.g. 728×90, 320×50) use a horizontal card.
    public var isHorizontal: Bool {
        guard responsive != .responsiveNative, let w = width, let h = height, h > 0 else { return false }
        return Double(w) / Double(h) > 2.5
    }
}

public struct DeliveryResponse: Codable, Equatable, Sendable {
    public var contractVersion: String
    public var placement: PlacementInfo?
    public var ad: RenderableAd?
    public var reason: String?
}

/// Outcome of a placement request. Never an error the host has to handle.
public enum AdResult: Equatable, Sendable {
    case ad(RenderableAd, PlacementInfo?)
    /// Nothing to show. Apply `fallback` (collapse unless the placement says otherwise).
    case empty(reason: String, fallback: FallbackBehavior, placement: PlacementInfo?)

    public var ad: RenderableAd? {
        if case let .ad(ad, _) = self { return ad }
        return nil
    }
}
