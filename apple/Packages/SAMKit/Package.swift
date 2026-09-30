// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SAMKit",
    platforms: [.macOS(.v26), .iOS(.v26), .visionOS(.v26), .watchOS(.v26)],
    products: [
        .library(name: "SAMKit", targets: ["SAMKit"]),
    ],
    targets: [
        .target(name: "SAMKit"),
        .testTarget(name: "SAMKitTests", dependencies: ["SAMKit"]),
    ],
    swiftLanguageModes: [.v5]
)
