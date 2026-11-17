//! The `ad4m-client` pin carries the reconnect fix (Lal round 1, F3).
//!
//! The A5 head (`fb3e212b`) pins a `ws://localhost` dial to the loopback
//! literals on the first connect only; its supervisor redials through the
//! resolver, so the pin is lost after the first reconnect. The A6 lineage
//! (`20847b994` and later) routes connect and reconnect through one pinned
//! dial, with a test in `ad4m-client` (`ws_rpc` tests, `dialed_addrs`)
//! that fails when either dial goes through the resolver.
//!
//! That hook is `cfg(test)` inside `ad4m-client`, and making `localhost`
//! resolve elsewhere needs root, so the dial itself cannot be observed from
//! here. What this test holds instead: the manifest and the lockfile name
//! the same rev, and it is not one known to lose the pin.
const MANIFEST: &str = include_str!("../Cargo.toml");
const LOCK: &str = include_str!("../../Cargo.lock");

/// Revs of `coasys/ad4m` whose reconnect dials through the resolver.
const LOSES_LOCALHOST_PIN: &[&str] = &["fb3e212b1550f4ef064921a0114b0c449a2a7cb8"];

fn manifest_rev() -> &'static str {
    let line = MANIFEST
        .lines()
        .find(|l| l.starts_with("ad4m-client"))
        .expect("we-ad4m depends on ad4m-client");
    let start = line.find("rev = \"").expect("pinned by rev") + "rev = \"".len();
    &line[start..start + 40]
}

fn lock_rev() -> &'static str {
    let at = LOCK
        .find("name = \"ad4m-client\"")
        .expect("ad4m-client in Cargo.lock");
    let source = LOCK[at..]
        .lines()
        .find(|l| l.starts_with("source = "))
        .expect("a source line");
    source.rsplit('#').next().unwrap().trim_end_matches('"')
}

#[test]
fn pin_is_one_rev_and_keeps_the_localhost_pin_across_reconnects() {
    let rev = manifest_rev();
    assert!(
        lock_rev().starts_with(&rev[..9]) || rev.starts_with(lock_rev()),
        "Cargo.toml pins {rev}, Cargo.lock resolved {}",
        lock_rev()
    );
    assert!(
        !LOSES_LOCALHOST_PIN.contains(&rev),
        "ad4m-client {rev} redials ws://localhost through the resolver after a reconnect; \
         pin the A6 lineage (d2e6fab93 or later)"
    );
}
