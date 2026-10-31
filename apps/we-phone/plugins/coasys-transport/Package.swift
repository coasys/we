// swift-tools-version: 5.9
// UNVERIFIED: written on Linux for spike 1. The Rust library comes in as a binary target built by
// apps/we-phone/scripts/build-ios.sh; the uniffi Swift bindings are generated next to the plugin.
import PackageDescription

let package = Package(
    name: "CoasysCapacitorTransport",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "CoasysCapacitorTransport", targets: ["CoasysTransportPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
    ],
    targets: [
        // libwe_phone_transport.a for device and simulator, with the uniffi C header and a
        // module map naming it `we_phone_transportFFI`, which the generated Swift imports.
        .binaryTarget(name: "we_phone_transportFFI", path: "ios/Frameworks/WePhoneTransport.xcframework"),
        .target(
            name: "CoasysTransportPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "we_phone_transportFFI",
            ],
            path: "ios/Sources/CoasysTransportPlugin"
        ),
    ]
)
