//! The bindings generator, built with this crate's own uniffi version so the two always agree.
//! `cargo run --features bindgen --bin uniffi-bindgen -- generate --library <lib> --language kotlin --out-dir <dir>`
fn main() {
    uniffi::uniffi_bindgen_main()
}
