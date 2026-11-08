// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.0"),
        .package(name: "CapacitorBarcodeScanner", path: "../../../../../node_modules/.pnpm/@capacitor+barcode-scanner@3.1.3_@capacitor+core@8.6.0/node_modules/@capacitor/barcode-scanner"),
        .package(name: "CoasysCapacitorTransport", path: "../../../plugins/coasys-transport")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorBarcodeScanner", package: "CapacitorBarcodeScanner"),
                .product(name: "CoasysCapacitorTransport", package: "CoasysCapacitorTransport")
            ]
        )
    ]
)
