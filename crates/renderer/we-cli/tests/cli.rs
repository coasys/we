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

#[test]
fn catalog_fallback_keeps_its_multiline_content() {
    // A catalog fallback is not one line — a graph outline, a block
    // document, a textarea's value are multi-line announcements, and an
    // unknown widget's label still prints under its `ty` marker.
    let manifest = env!("CARGO_MANIFEST_DIR");
    let bundle = format!("{manifest}/tests/data/outline.bundle.json");
    let out = Command::new(env!("CARGO_BIN_EXE_we-cli"))
        .args(["--bundle", &bundle])
        .output()
        .expect("we-cli runs");
    assert!(
        out.status.success(),
        "we-cli failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);

    // GraphView: the header and every node/edge line.
    for wanted in [
        "GraphView",
        "2 nodes",
        "Draft",
        "Review",
        "1 edges",
        "Draft → Review (next)",
    ] {
        assert!(stdout.contains(wanted), "expected '{wanted}' in:\n{stdout}");
    }

    // we-textarea: every line of the value, not just the first.
    for wanted in ["first line", "second line", "third line"] {
        assert!(stdout.contains(wanted), "expected '{wanted}' in:\n{stdout}");
    }

    // BlockComposer: the flattened document, nested blocks indented.
    for wanted in ["Hello world", "Nested item"] {
        assert!(stdout.contains(wanted), "expected '{wanted}' in:\n{stdout}");
    }

    // Unknown leaf: its label still shows under the `ty` marker.
    assert!(
        stdout.contains("we-widget-9000  Strange fruit"),
        "expected the unknown widget's label:\n{stdout}"
    );
}
