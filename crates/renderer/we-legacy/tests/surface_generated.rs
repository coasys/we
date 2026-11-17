//! `src/surface.rs` is generated from `templateSurface.ts` (E3c-8a r2, Lal:
//! "no regeneration script for the 907 rows"). This test runs the committed
//! generator in `--check` mode: a hand edit to the table, or a TS change that
//! was not regenerated, fails here. It needs `node` and `rustfmt` on PATH —
//! the same tools the generator does — and fails, rather than skipping, when
//! either is missing: an unchecked table is the state this replaced.
use std::path::Path;
use std::process::Command;

#[test]
fn the_committed_surface_matches_a_fresh_generation() {
    let renderer = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let script = renderer.join("scripts/gen-legacy-surface.mjs");
    let out = Command::new("node")
        .arg(&script)
        .arg("--check")
        .current_dir(&renderer)
        .output()
        .unwrap_or_else(|e| panic!("could not run node {}: {e}", script.display()));
    assert!(
        out.status.success(),
        "we-legacy/src/surface.rs is not what the generator writes:\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}
