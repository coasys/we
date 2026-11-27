#!/usr/bin/env bash
# Builds the Rust half of CoasysTransport for Android and writes its Kotlin bindings.
#
#   1. cargo-ndk builds crates/phone-transport for arm64-v8a (phones) and x86_64 (the emulator)
#      into android/app/src/main/jniLibs/<abi>/libwe_phone_transport.so.
#   2. uniffi-bindgen, built from the same crate so the versions agree, reads that library and
#      writes the Kotlin bindings into the plugin: plugins/coasys-transport/android/src/main/java/uniffi/.
#
# Needs: rustup, cargo-ndk, and ANDROID_NDK_HOME (or ANDROID_HOME with an NDK in it).
set -euo pipefail

app="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$(cd "$app/../../crates/phone-transport" && pwd)"
jni="$app/android/app/src/main/jniLibs"
kotlin_out="$app/plugins/coasys-transport/android/src/main/java"

cd "$crate"
# The crate's rust-toolchain.toml picks the channel; make sure it has the two Android targets.
rustup target add aarch64-linux-android x86_64-linux-android >/dev/null

# minSdk 30: link against the API 30 platform.
cargo ndk --platform 30 -t arm64-v8a -t x86_64 -o "$jni" build --release --lib

# The bindings are read from a host debug build of the same source: the release `.so` is stripped
# and LTO'd, which drops the metadata uniffi-bindgen reads. The interface is the same on every
# target, so the bindings are too.
cargo build --quiet --lib
rm -rf "$kotlin_out/uniffi"
cargo run --quiet --features bindgen --bin uniffi-bindgen -- generate \
  --library "$crate/target/debug/libwe_phone_transport.so" \
  --language kotlin \
  --no-format \
  --out-dir "$kotlin_out"

echo "jniLibs:"
find "$jni" -name '*.so' -exec ls -l {} \;
echo "Kotlin bindings:"
find "$kotlin_out/uniffi" -name '*.kt'
