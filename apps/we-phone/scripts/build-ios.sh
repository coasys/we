#!/usr/bin/env bash
# Builds the Rust half of CoasysTransport for iOS as an XCFramework, and writes its Swift bindings.
#
# UNVERIFIED: written on Linux for spike 1 and never run. Needs macOS with Xcode.
#
#   1. cargo builds crates/phone-transport as a static library for the device (aarch64-apple-ios)
#      and the simulator (aarch64-apple-ios-sim, x86_64-apple-ios, joined with lipo).
#   2. uniffi-bindgen writes the Swift bindings, the C header and the module map.
#   3. xcodebuild wraps both libraries and the header in WePhoneTransport.xcframework, which the
#      plugin's Package.swift names as a binary target.
set -euo pipefail

app="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$(cd "$app/../../crates/phone-transport" && pwd)"
plugin="$app/plugins/coasys-transport/ios"
work="$app/ios-build"
lib=libwe_phone_transport.a

cd "$crate"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios >/dev/null
export IPHONEOS_DEPLOYMENT_TARGET=15.0
for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
  cargo build --release --lib --target "$target"
done

rm -rf "$work"
mkdir -p "$work/sim" "$work/headers" "$work/swift"
lipo -create \
  "target/aarch64-apple-ios-sim/release/$lib" \
  "target/x86_64-apple-ios/release/$lib" \
  -output "$work/sim/$lib"

# Bindings from a host build: the release libraries are LTO'd and carry no uniffi metadata.
cargo build --quiet --lib
cargo run --quiet --features bindgen --bin uniffi-bindgen -- generate \
  --library "target/debug/libwe_phone_transport.dylib" \
  --language swift \
  --out-dir "$work/swift"

cp "$work/swift/we_phone_transportFFI.h" "$work/headers/"
# An XCFramework's headers directory is a module when it holds `module.modulemap`.
cp "$work/swift/we_phone_transportFFI.modulemap" "$work/headers/module.modulemap"

rm -rf "$plugin/Frameworks/WePhoneTransport.xcframework"
mkdir -p "$plugin/Frameworks"
xcodebuild -create-xcframework \
  -library "target/aarch64-apple-ios/release/$lib" -headers "$work/headers" \
  -library "$work/sim/$lib" -headers "$work/headers" \
  -output "$plugin/Frameworks/WePhoneTransport.xcframework"

mkdir -p "$plugin/Sources/CoasysTransportPlugin/Generated"
cp "$work/swift/we_phone_transport.swift" "$plugin/Sources/CoasysTransportPlugin/Generated/"

echo "XCFramework: $plugin/Frameworks/WePhoneTransport.xcframework"
echo "Swift bindings: $plugin/Sources/CoasysTransportPlugin/Generated/we_phone_transport.swift"
