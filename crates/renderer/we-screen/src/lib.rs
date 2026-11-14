//! `we-screen`: everything about "what is on screen" that is not model data —
//! `ScreenState`, the `Navigator`, the back stack. The design is written in
//! the plan (`plan/screen-state.md`); E2 builds it here against the
//! `paths.json` and `navigation.json` vectors.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn placeholder() {
        // Replaced by E2's vector tests (`paths.json`, `navigation.json`).
    }
}
