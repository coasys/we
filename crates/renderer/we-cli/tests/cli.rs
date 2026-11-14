//! Run the binary against the repo bundle + the tree snapshot — a known
//! channel name must appear in the outline.
use std::process::Command;

#[test]
fn prints_the_space_tree_outline() {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let bundle = format!("{manifest}/../../../bundles/coasys.bundle.json");
    let snapshot = format!("{manifest}/../we-app/tests/data/tree-snapshot.json");
    let out = Command::new(env!("CARGO_BIN_EXE_we-cli"))
        .args(["--bundle", &bundle, "--snapshot", &snapshot])
        .output()
        .expect("we-cli runs");
    assert!(
        out.status.success(),
        "we-cli failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("General"),
        "expected channel 'General' in the outline:\n{stdout}"
    );
    // The outline's whole point is the catalog's text fallback — assert on
    // words only it produces, never a plain text child: the gear icon's
    // `name` prop and the tree's `selected` value. (Disabling the label
    // output in `outline()` must fail this.)
    assert!(
        stdout.contains("we-icon  gear-six"),
        "expected the icon's catalog fallback 'gear-six':\n{stdout}"
    );
    assert!(
        stdout.contains("channel|demo"),
        "expected the tree's catalog fallback 'channel|demo':\n{stdout}"
    );
}
