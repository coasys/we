#!/usr/bin/env bash
# Builds the Rust half of the DeviceKey plugin (crates/phone-custody) for Android and writes its
# Kotlin bindings.
#
#   1. cargo-ndk builds the crate for arm64-v8a (phones) and x86_64 (the emulator) into
#      android/app/src/main/jniLibs/<abi>/libwe_phone_custody.so.
#   2. uniffi-bindgen, built from the same crate so the versions agree, reads a host build of the
#      library and writes the Kotlin bindings to android/app/src/main/java/uniffi/.
#   3. The host build itself is copied to android/app/build/host-lib/, where the JVM unit tests
#      (android/app/src/test) load it, so they run the same Rust the phone does.
#
# Both outputs are build products, ignored by git. Run it before `./gradlew assembleDebug`.
# Needs: rustup, cargo-ndk, and ANDROID_NDK_HOME (or ANDROID_HOME with an NDK in it).
set -euo pipefail

app="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$(cd "$app/../../crates/phone-custody" && pwd)"
jni="$app/android/app/src/main/jniLibs"
kotlin_out="$app/android/app/src/main/java"
host_lib="$app/android/app/build/host-lib"

cd "$crate"
# The crate's rust-toolchain.toml picks the channel; make sure it has the two Android targets.
rustup target add aarch64-linux-android x86_64-linux-android >/dev/null

# minSdk 30: link against the API 30 platform.
cargo ndk --platform 30 -t arm64-v8a -t x86_64 -o "$jni" build --release --lib

# The bindings are read from a host debug build of the same source: the release `.so` is stripped
# and LTO'd, which drops the metadata uniffi-bindgen reads. The interface is the same on every
# target, so the bindings are too.
cargo build --quiet --lib
case "$(uname -s)" in
  Darwin) lib_file="libwe_phone_custody.dylib" ;;
  *) lib_file="libwe_phone_custody.so" ;;
esac
rm -rf "$kotlin_out/uniffi"
cargo run --quiet --features bindgen --bin uniffi-bindgen -- generate \
  --library "$crate/target/debug/$lib_file" \
  --language kotlin \
  --no-format \
  --out-dir "$kotlin_out"
mkdir -p "$host_lib"
cp "$crate/target/debug/$lib_file" "$host_lib/"

echo "jniLibs:"
find "$jni" -name '*.so' -exec ls -l {} \;
echo "Kotlin bindings:"
find "$kotlin_out/uniffi" -name '*.kt'
