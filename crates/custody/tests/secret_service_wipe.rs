//! The copy of a secret the Secret Service store hands to its client's thread is wiped, not just
//! freed: every heap block freed while `put` runs is checked for the secret.
//!
//! A test binary of its own, because it replaces the allocator. Skipped unless
//! `CUSTODY_SECRET_SERVICE=1`; run it the way the header of `tests/secret_service.rs` says, with
//! `--test secret_service_wipe`.
#![cfg(target_os = "linux")]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use we_custody::store::{SecretServiceStore, SecretStore};

const SECRET: &[u8] = b"sealed bytes that must not outlive the call";

static WATCHING: AtomicBool = AtomicBool::new(false);
static FREED_WITH_SECRET: AtomicUsize = AtomicUsize::new(0);

/// The system allocator, counting the blocks freed with the secret still in them while watching.
struct Watching;

unsafe impl GlobalAlloc for Watching {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if WATCHING.load(Ordering::SeqCst) && layout.size() >= SECRET.len() {
            let block = std::slice::from_raw_parts(ptr, layout.size());
            if block.windows(SECRET.len()).any(|w| w == SECRET) {
                FREED_WITH_SECRET.fetch_add(1, Ordering::SeqCst);
            }
        }
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Watching = Watching;

#[test]
fn the_copy_that_crosses_threads_is_wiped() {
    if std::env::var("CUSTODY_SECRET_SERVICE").as_deref() != Ok("1") {
        eprintln!("skipped: set CUSTODY_SECRET_SERVICE=1 (see the header of this file)");
        return;
    }
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_default();
    assert!(
        !runtime_dir.starts_with("/run/user/"),
        "this would write to the person's own keyring: run it in a session of its own"
    );

    let store = SecretServiceStore::connect().expect("a Secret Service in this session");
    let name = format!("coasys.identity/test-wipe-{}", std::process::id());
    // The caller's own copy, freed after the watch.
    let secret = SECRET.to_vec();
    WATCHING.store(true, Ordering::SeqCst);
    store.put(&name, &secret).unwrap();
    WATCHING.store(false, Ordering::SeqCst);
    store.delete(&name).unwrap();
    assert_eq!(FREED_WITH_SECRET.load(Ordering::SeqCst), 0);
}
