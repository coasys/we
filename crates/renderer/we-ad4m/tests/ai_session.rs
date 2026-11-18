//! A chat in the Rust app continues a session the web API started.
//!
//! The arrange step calls `ai.sessionCreate` and `ai.sessionSend`, the same
//! methods web We uses. The act step is [`ChatModel`] over [`AiSessionChat`].
//! `EXECUTOR_PATH` is a local executor. Without it the tests skip. They never
//! dial staging and they never use a personal account. `agent.generate`
//! mints the local test account. A session event names that account's DID,
//! so a socket opened before generate receives nothing.
use std::time::{Duration, Instant};

use we_ad4m::ai_session::{
    session_cancel, session_create, session_send, AiSessionCancelParams, AiSessionCreate,
    AiSessionSendParams,
};
use we_ad4m::testkit as kit;
use we_ad4m::{AiSessionChat, Connection, Runtime};
use we_data::chat::{ChatModel, ChatPort};

struct Live {
    _executor: kit::Executor,
    rt: Runtime,
    conn: Connection,
}

fn live() -> Option<Live> {
    let executor = kit::start_executor()?;
    let rt = Runtime::new().expect("runtime");
    let conn = kit::connect(&rt, &executor.url);
    let status = rt
        .block_on(conn.client().agent.generate("passphrase".into()))
        .expect("agent.generate");
    assert!(
        status.is_unlocked && status.did.is_some(),
        "the local test account has no DID: {status:?}"
    );
    Some(Live {
        _executor: executor,
        rt,
        conn,
    })
}

fn web<T>(rt: &Runtime, fut: impl std::future::Future<Output = anyhow::Result<T>>) -> T {
    rt.block_on(fut)
        .unwrap_or_else(|err| panic!("web call failed: {err:#}"))
}

/// Store `text` the way web We does, then cancel the running turn so the
/// next send is not refused as busy.
fn say(rt: &Runtime, conn: &Connection, id: &str, text: &str) {
    let ws = conn.ws().clone();
    web(
        rt,
        session_send(
            &ws,
            &AiSessionSendParams {
                session_id: id.to_string(),
                text: text.to_string(),
            },
        ),
    );
    let _ = rt.block_on(session_cancel(
        &ws,
        &AiSessionCancelParams {
            session_id: id.to_string(),
        },
    ));
}

fn open_session(rt: &Runtime, conn: &Connection, title: Option<&str>) -> String {
    let ws = conn.ws().clone();
    web(
        rt,
        session_create(
            &ws,
            &AiSessionCreate {
                title: title.map(str::to_string),
                ..AiSessionCreate::default()
            },
        ),
    )
    .id
}

fn rust_send(model: &mut ChatModel) {
    model.send();
    if model
        .view
        .send_failed
        .as_deref()
        .is_some_and(|msg| msg.contains("already running"))
    {
        model.cancel();
        model.send();
    }
}

#[test]
fn a_rust_chat_continues_a_session_the_web_api_started() {
    let Some(live) = live() else {
        return;
    };
    let id = open_session(&live.rt, &live.conn, Some("From the web"));
    say(&live.rt, &live.conn, &id, "hello from web");

    let mut model = ChatModel::new(Box::new(AiSessionChat::new(&live.conn)));
    assert_eq!(model.view.summaries.len(), 1);
    assert_eq!(model.view.summaries[0].id, id);
    model.open(&id);
    assert!(
        model
            .view
            .messages
            .iter()
            .any(|turn| turn.text == "hello from web"),
        "{:?}",
        model.view.messages
    );
    model.set_draft("and from rust".to_string());
    rust_send(&mut model);
    assert_eq!(
        model.view.send_failed.as_deref(),
        None,
        "draft {:?}",
        model.view.draft
    );
    assert!(
        model
            .view
            .messages
            .iter()
            .any(|turn| turn.text == "and from rust"),
        "{:?}",
        model.view.messages
    );
    assert_eq!(model.view.summaries.len(), 1);
    assert_eq!(
        model.view.active.as_ref().map(|active| active.id.as_str()),
        Some(id.as_str())
    );
    model.cancel();
}

#[test]
fn a_create_arrives_on_ai_session_changed() {
    let Some(live) = live() else {
        return;
    };
    let mut model = ChatModel::new(Box::new(AiSessionChat::new(&live.conn)));
    assert!(model.view.summaries.is_empty());
    let id = open_session(&live.rt, &live.conn, Some("From the web"));
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut arrived = false;
    while Instant::now() < deadline {
        if model.follow() && model.view.summaries.iter().any(|row| row.id == id) {
            arrived = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(arrived, "summaries {:?}", model.view.summaries);
    assert_eq!(model.view.summaries[0].title, "From the web");
}

#[test]
fn an_older_page_stops_before_the_named_seq() {
    let Some(live) = live() else {
        return;
    };
    let id = open_session(&live.rt, &live.conn, None);
    say(&live.rt, &live.conn, &id, "one");
    say(&live.rt, &live.conn, &id, "two");

    let mut port = AiSessionChat::new(&live.conn);
    let rows = port.messages(&id).unwrap();
    let two_seq = rows
        .iter()
        .find(|row| row.content.text.as_deref() == Some("two"))
        .unwrap()
        .seq;
    let page = port.messages_before(&id, two_seq, 10).unwrap();
    assert!(page
        .iter()
        .any(|row| row.content.text.as_deref() == Some("one")));
    assert!(
        page.iter().all(|row| row.seq < two_seq),
        "{:?}",
        page.iter().map(|row| row.seq).collect::<Vec<_>>()
    );
}
