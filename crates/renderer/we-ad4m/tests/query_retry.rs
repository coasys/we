//! B3, against a real executor (`EXECUTOR_PATH`; skipped without it): a
//! query that failed because the space lacked the class does not stay
//! failed. Once the class is there, showing the page again reads it.
use we_ad4m::testkit as kit;

use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use we_ad4m::{Ad4mQuerySource, SpaceBinding};
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{LocalState, NoParts, Runtime, SchemaNode, StaticHost, StoreBag};

/// A page that reads tasks, and somewhere else to go: the list is mounted
/// only at `/`, as a route's page is.
fn schema() -> SchemaNode {
    serde_json::from_value(serde_json::json!({
        "type": "Column",
        // The sidebar asks the same question and never leaves, so the cell
        // is shared and outlives the page.
        "$queries": { "side": { "entity": "TaskBlock", "limit": 50 } },
        "children": [{ "type": "we-text", "children": [{ "$": "`side=${local.sideLoaded}`" }] }, {
            "type": "$if",
            "props": {
                "condition": { "$": "routeStore.currentPath == '/'" },
                "then": {
                    "type": "Column",
                    "$queries": { "tasks": { "entity": "TaskBlock", "limit": 50 } },
                    "children": [
                        { "type": "we-text", "children": [{ "$": "`loaded=${local.tasksLoaded} n=${count(local.tasks)}`" }] },
                        { "type": "$each",
                          "props": { "items": { "$": "local.tasks" }, "as": "t" },
                          "children": [{ "type": "we-text", "children": [{ "$": "t.title" }] }] }
                    ]
                },
                "else": { "type": "we-text", "children": ["elsewhere"] }
            }
        }]
    }))
    .unwrap()
}

fn navigate(to: &str) -> ScreenOp {
    ScreenOp::Navigate {
        to: to.into(),
        query: None,
        base_depth: None,
        replace: false,
    }
}

fn tree_text(session: &mut Session) -> String {
    we_template::normal_form(&session.resolve()).to_string()
}

fn wait_for(
    session: &mut Session,
    wake: &mpsc::Receiver<()>,
    needle: &str,
    limit: Duration,
) -> Result<(), String> {
    let start = Instant::now();
    loop {
        let text = tree_text(session);
        if text.contains(needle) {
            return Ok(());
        }
        let left = limit.saturating_sub(start.elapsed());
        if left.is_zero() {
            return Err(format!(
                "{needle:?} not in the tree after {limit:?}:\n{text}"
            ));
        }
        let _ = wake.recv_timeout(left.min(Duration::from_millis(200)));
    }
}

#[test]
fn a_failed_query_reads_again_when_its_page_is_shown_again() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let conn = kit::connect(&rt, &executor.url);
    // A space with no TaskBlock class: the query fails.
    let uuid = kit::seed_space(&rt, &conn, "b3-retry");
    let source = Arc::new(Ad4mQuerySource::new(
        kit::connect(&rt, &executor.url),
        SpaceBinding::new(&uuid),
    ));
    let stats = source.stats();
    let bag = Arc::new(StoreBag::new());
    let runtime = Runtime::new(schema(), "b3", bag.clone(), LocalState::new())
        .with_sources(Some(source), Arc::new(NoParts));
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let mut session = Session::from_parts(runtime, Box::new(StaticHost::new(bag)), screen);
    let (tx, wake) = mpsc::channel();
    session.set_waker(Arc::new(move || {
        let _ = tx.send(());
    }));

    wait_for(
        &mut session,
        &wake,
        "loaded=true n=0",
        Duration::from_secs(30),
    )
    .unwrap();
    assert!(
        stats.failures.load(Ordering::Relaxed) >= 1,
        "the first read failed"
    );

    // The space gains the class and a record.
    kit::add_class(&rt, &conn, &uuid, "TaskBlock", kit::TASK_SDNA);
    kit::create_task(&rt, &conn, &uuid, "Now it exists");

    // Away and back — once the failure is past the hub's retry cooldown, so
    // a failure that did not go away would not be asked again in a loop.
    std::thread::sleep(we_template::RETRY_COOLDOWN + Duration::from_millis(200));
    // Away and back.
    session.apply_screen(navigate("/elsewhere"));
    wait_for(&mut session, &wake, "elsewhere", Duration::from_secs(10)).unwrap();
    session.apply_screen(navigate("/"));
    wait_for(
        &mut session,
        &wake,
        "Now it exists",
        Duration::from_secs(10),
    )
    .unwrap_or_else(|e| {
        panic!(
            "{e}\nfailed reads: {}",
            stats.failures.load(Ordering::Relaxed)
        )
    });
}
