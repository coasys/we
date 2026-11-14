//! A word or passphrase a request line carries is wiped, not just freed, on the way through the
//! sidecar: the line buffer, the request read from it, and a step input that is refused, malformed
//! or never read. Every heap block freed while the sidecar serves is checked for the secret.
//!
//! A test binary of its own, because it replaces the allocator. What it cannot see is outside the
//! process (the window's fields, the host's IPC message) or not in this path: a string with JSON
//! escapes in it is unescaped into serde_json's scratch buffer, which nothing wipes (the 12 words
//! and a typed passphrase do not normally have any).

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use we_custody::service::{spawn, ExecutorAddress};
use we_custody::sidecar::{serve, MAX_LINE};
use we_custody::store::MemoryStore;
use we_custody::{DesktopVault, PendingIncepts};

const SECRET: &[u8] = b"wipe-me-correct-horse-battery-staple-0451";

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
fn a_secret_in_a_request_line_is_wiped_whether_the_step_reads_it_or_not() {
    let secret = std::str::from_utf8(SECRET).unwrap();
    // Built before watching, and dropped after: the test's own copies are not the sidecar's.
    let lines = [
        // Well formed, refused: no step is open.
        format!(
            r#"{{"id":1,"method":"step","params":{{"input":{{"kind":"twelve-words","words":"{secret}"}}}}}}"#
        ),
        format!(
            r#"{{"id":2,"method":"step","params":{{"input":{{"kind":"passphrase","passphrase":"{secret}","confirm":"{secret}"}}}}}}"#
        ),
        // Malformed after the secret was read: one answer of two.
        format!(
            r#"{{"id":3,"method":"step","params":{{"input":{{"kind":"words","answers":["{secret}"]}}}}}}"#
        ),
        // Not a request: no method.
        format!(r#"{{"id":4,"params":{{"input":{{"kind":"twelve-words","words":"{secret}"}}}}}}"#),
        // Too long to be one.
        format!(
            r#"{{"id":5,"method":"step","params":{{"input":{{"kind":"twelve-words","words":"{secret}{}"}}}}}}"#,
            " ".repeat(MAX_LINE)
        ),
        r#"{"id":6,"method":"cancel"}"#.to_string(),
    ];
    let input = lines.join("\n");
    let mut output = Vec::new();

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    WATCHING.store(true, Ordering::SeqCst);
    runtime.block_on(async {
        let custody = spawn(
            DesktopVault::new(Box::new(MemoryStore::new()), PendingIncepts::memory()),
            // No executor answers on port 9, and nothing here asks one.
            ExecutorAddress {
                url: "http://127.0.0.1:9".into(),
                credential: Arc::from("x"),
            },
        );
        serve(custody, input.as_bytes(), &mut output).await.unwrap();
    });
    drop(runtime);
    WATCHING.store(false, Ordering::SeqCst);

    let answers: Vec<serde_json::Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let error = |id: serde_json::Value| {
        answers
            .iter()
            .find(|a| a["id"] == id)
            .unwrap_or_else(|| panic!("no answer for {id} in {answers:?}"))["error"]
            .clone()
    };
    assert_eq!(error(1.into()), "no step is open");
    assert_eq!(error(2.into()), "no step is open");
    assert_eq!(error(3.into()), "the params of `step` are not valid");
    assert_eq!(error(4.into()), "not a request");
    assert_eq!(error(serde_json::Value::Null), "line too long");
    assert!(answers.iter().any(|a| a["id"] == 6));
    assert!(!serde_json::to_string(&answers).unwrap().contains(secret));
    assert_eq!(
        FREED_WITH_SECRET.load(Ordering::SeqCst),
        0,
        "a block was freed with the secret still in it"
    );
    drop(lines);
}
