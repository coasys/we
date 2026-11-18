//! A chat in the Rust app continues a session the web API started.
//!
//! The arrange step calls `ai.sessionCreate` and `ai.sessionSend`, the same
//! methods web We uses. The act step is [`ChatModel`] over [`AiSessionChat`]
//! on a minted user grant, not the operator. `EXECUTOR_PATH` is a local
//! executor. Without it the tests skip. They never dial staging and they
//! never use a personal account. `agent.generate` on the operator mints the
//! local test account. The chat token is `write_capabilities` for one space.
use std::time::{Duration, Instant};

use we_ad4m::ai_session::{
    session, session_cancel, session_create, session_send, AiIdParams, AiSessionCancelParams,
    AiSessionCreate, AiSessionSendParams, Capability, Resource,
};
use we_ad4m::connect::{read_only_capabilities, write_capabilities};
use we_ad4m::testkit as kit;
use we_ad4m::{AiSessionChat, Connection, Runtime};
use we_data::chat::{space_cap, ChatAccess, ChatAuthority, ChatModel, ChatPort};

struct Live {
    _executor: kit::Executor,
    rt: Runtime,
    user: Connection,
    space: String,
}

fn live() -> Option<Live> {
    let executor = kit::start_executor_with_admin("e18-admin")?;
    let rt = Runtime::new().expect("runtime");
    let operator = kit::connect_as(&rt, &executor.url, "e18-admin");
    let status = rt
        .block_on(operator.client().agent.generate("passphrase".into()))
        .expect("agent.generate");
    assert!(
        status.is_unlocked && status.did.is_some(),
        "the local test account has no DID: {status:?}"
    );
    let space = rt
        .block_on(operator.client().perspectives.add("e18-space".into()))
        .expect("perspective")
        .uuid;
    let token = kit::mint_token(
        &rt,
        &executor.url,
        &operator,
        "e18-chat",
        serde_json::to_value(write_capabilities(&space)).unwrap(),
    );
    let user = kit::connect_as(&rt, &executor.url, &token);
    let user_status = rt
        .block_on(user.client().agent.status())
        .expect("agent.status");
    if user_status.did.is_none() {
        let generated = rt
            .block_on(user.client().agent.generate("passphrase".into()))
            .expect("the chat grant's agent has no DID");
        assert!(generated.did.is_some(), "{generated:?}");
    }
    Some(Live {
        _executor: executor,
        rt,
        user,
        space,
    })
}

fn chat(live: &Live) -> ChatModel {
    ChatModel::bound(
        Box::new(AiSessionChat::new(&live.user)),
        ChatAuthority::space(
            live.space.clone(),
            Some("e18-space".to_string()),
            ChatAccess::Write,
        ),
    )
}

fn scoped(title: Option<&str>, space: &str) -> AiSessionCreate {
    let cap = space_cap(space);
    AiSessionCreate {
        title: title.map(str::to_string),
        default_perspective: Some(space.to_string()),
        capabilities: Some(vec![Capability {
            with: Resource {
                domain: cap.domain,
                pointers: cap.pointers,
            },
            can: cap.can,
        }]),
        ..AiSessionCreate::default()
    }
}

fn web<T>(rt: &Runtime, fut: impl std::future::Future<Output = anyhow::Result<T>>) -> T {
    rt.block_on(fut)
        .unwrap_or_else(|err| panic!("web call failed: {err:#}"))
}

/// Store `text` the way web We does, then cancel the running turn so the
/// next send is not refused as busy.
fn say(live: &Live, id: &str, text: &str) {
    let ws = live.user.ws().clone();
    web(
        &live.rt,
        session_send(
            &ws,
            &AiSessionSendParams {
                session_id: id.to_string(),
                text: text.to_string(),
            },
        ),
    );
    let _ = live.rt.block_on(session_cancel(
        &ws,
        &AiSessionCancelParams {
            session_id: id.to_string(),
        },
    ));
}

fn open_session(live: &Live, title: Option<&str>) -> String {
    let ws = live.user.ws().clone();
    web(&live.rt, session_create(&ws, &scoped(title, &live.space))).id
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
    let id = open_session(&live, Some("From the web"));
    say(&live, &id, "hello from web");

    let mut model = chat(&live);
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
    let mut model = chat(&live);
    assert!(model.view.summaries.is_empty());
    let id = open_session(&live, Some("From the web"));
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
    let id = open_session(&live, None);
    say(&live, &id, "one");
    say(&live, &id, "two");

    let mut port = AiSessionChat::new(&live.user);
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

#[test]
fn a_read_only_grant_can_list_and_cannot_create() {
    let Some(executor) = kit::start_executor_with_admin("e18-admin") else {
        return;
    };
    let rt = Runtime::new().expect("runtime");
    let operator = kit::connect_as(&rt, &executor.url, "e18-admin");
    rt.block_on(operator.client().agent.generate("passphrase".into()))
        .expect("agent.generate");
    let space = rt
        .block_on(operator.client().perspectives.add("e18-readonly".into()))
        .expect("perspective")
        .uuid;
    let token = kit::mint_token(
        &rt,
        &executor.url,
        &operator,
        "e18-readonly",
        serde_json::to_value(read_only_capabilities()).unwrap(),
    );
    let user = kit::connect_as(&rt, &executor.url, &token);
    let mut port = AiSessionChat::new(&user);
    port.list().expect("AI READ can list");
    let err = port
        .create("t", Some(&space))
        .expect_err("AI CREATE is not in the read-only grant");
    let msg = err.to_string();
    assert!(
        msg.contains("403") || msg.to_lowercase().contains("capab"),
        "{msg}"
    );
}

#[test]
fn a_user_create_does_not_receive_every_capability() {
    let Some(live) = live() else {
        return;
    };
    let mut model = chat(&live);
    model.set_draft("scoped hello".to_string());
    rust_send(&mut model);
    assert_eq!(
        model.view.send_failed.as_deref(),
        None,
        "draft {:?}",
        model.view.draft
    );
    let id = model
        .view
        .active
        .as_ref()
        .map(|active| active.id.clone())
        .expect("created");
    let ws = live.user.ws().clone();
    let stored = web(&live.rt, session(&ws, &AiIdParams { id: id.clone() }));
    assert!(
        !stored.capabilities.is_empty(),
        "a space chat has a perspective cap"
    );
    assert!(
        stored
            .capabilities
            .iter()
            .all(|cap| cap.with.domain == "perspective"),
        "null capabilities would store the whole grant: {:?}",
        stored.capabilities
    );
    assert!(
        stored
            .capabilities
            .iter()
            .all(|cap| cap.with.pointers == vec![live.space.clone()]),
        "{:?}",
        stored.capabilities
    );
    let verbs: Vec<&str> = stored
        .capabilities
        .iter()
        .flat_map(|cap| cap.can.iter().map(String::as_str))
        .collect();
    assert!(
        verbs
            .iter()
            .all(|verb| *verb == "READ" || *verb == "UPDATE")
            && verbs.contains(&"READ")
            && verbs.contains(&"UPDATE"),
        "requested verbs are READ and UPDATE: {:?}",
        stored.capabilities
    );
    model.cancel();
}
