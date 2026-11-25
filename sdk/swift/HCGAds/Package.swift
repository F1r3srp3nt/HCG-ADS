// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HCGAds",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "HCGAdsCore", targets: ["HCGAdsCore"]),
        .library(name: "HCGAdsUI", targets: ["HCGAdsUI"]),
    ],
    targets: [
        .target(name: "HCGAdsCore"),
        .target(name: "HCGAdsUI", dependencies: ["HCGAdsCore"]),
        .testTarget(name: "HCGAdsCoreTests", dependencies: ["HCGAdsCore"]),
    ]
)
