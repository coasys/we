//! Agent chat over executor AI sessions (E18).
//!
//! The transcript rules are the ones in
//! `packages/backend-system/ad4m/src/agentConversations.ts`
//! (`conversationOf`, `isWriteTool`, `scopeOf`, `summarize`) and the pure
//! reads in `packages/app-shell/.../chat/chatState.ts`. A session is an
//! `ai_sessions` row, not a perspective record. Refs carry only `id`.
//!
//! This module does not call the executor. [`ChatPort`] is the seam.
//! [`MemoryChat`] is the stand-in the headless tests drive. The live port
//! sits in we-ad4m. [`ChatModel::follow`] reloads after `ai-session-changed`.
//! [`ChatPort::messages_before`] pages older than a seq. [`ChatModel`] walks
//! those pages, so a transcript longer than [`MESSAGE_PAGE`] still shows.
//! The open space comes from [`ChatAuthority`], which the host sets. A
//! template does not. Reconnect stays out.
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde_json::Value as Json;

/// The executor's name for a call the session may not make.
pub const CAPABILITY_REFUSAL: &str = "Capability is not matched";

/// Verbs a scoped cap may contain. A stored cap may list fewer.
const SCOPED_CAN: [&str; 5] = ["READ", "CREATE", "UPDATE", "DELETE", "SUBSCRIBE"];

/// Perspective verbs the launcher write grant holds for one space.
/// READ is on `*`. UPDATE is on that space's uuid. The create request
/// asks those two on the uuid. It does not ask CREATE, DELETE, or
/// SUBSCRIBE, and it does not read the live token.
const HELD_CAN: [&str; 2] = ["READ", "UPDATE"];

/// The port could not run the call.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChatError {
    /// The node has no AI-session API. Distinct from a failed call.
    #[error("{0}")]
    Unavailable(String),
    /// The call ran and failed, or the arguments were refused here.
    #[error("{0}")]
    Failed(String),
}

/// One capability on a session, in the executor's shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatCap {
    pub domain: String,
    pub pointers: Vec<String>,
    pub can: Vec<String>,
}

/// What `scopeOf` is given. `default_perspective` is stored and not read:
/// the TS function ignores it, and a hosted session can name a default
/// while still being global.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionHead {
    pub capabilities: Vec<ChatCap>,
    pub default_perspective: Option<String>,
}

/// The payload one transcript row carries. Tool arguments are reduced to
/// the perspective id the step aimed at. `writes` is the executor's own
/// read/write call when the row has one (ad4m #1713).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RowContent {
    pub text: Option<String>,
    pub name: Option<String>,
    pub perspective_id: Option<String>,
    pub target: Option<String>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub writes: Option<bool>,
}

/// A row's role in `ai_messages`. Anything else is dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptRole {
    User,
    Assistant,
    Tool,
}

/// One `ai_messages` row, oldest-or-newest as the caller stored it.
/// `conversation_of` sorts by `seq`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptRow {
    pub id: String,
    pub seq: i64,
    pub role: TranscriptRole,
    pub content: RowContent,
    pub status: Option<String>,
    pub error: Option<String>,
    pub created_at_ms: i64,
}

/// Where a reply is. An unrecognised executor status becomes `Running`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyStatus {
    Running,
    Done,
    Failed,
    Cancelled,
    Interrupted,
}

/// How a tool call ended. `Stopped`: the reply ended before the call did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Running,
    Ok,
    Error,
    Stopped,
}

/// One tool call hanging off the reply that made it.
///
/// `writes` is the declared intent, recorded when the tool is called.
/// It does not mean the space changed. [`step_label`] says the outcome
/// beside that intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatStep {
    pub name: String,
    pub target: Option<String>,
    /// Declared write intent. Independent of [`outcome`].
    pub writes: bool,
    pub outcome: Outcome,
    pub refused: bool,
    pub error: Option<String>,
    pub summary: Option<String>,
}

/// A neutral turn. Tool rows are steps, not turns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnRole {
    User,
    Assistant,
}

/// One user message or one assistant reply, oldest first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTurn {
    pub id: String,
    pub role: TurnRole,
    pub text: String,
    pub created_at_ms: i64,
    pub status: Option<ReplyStatus>,
    pub error: Option<String>,
    pub refused: bool,
    pub steps: Vec<ChatStep>,
}

/// A row in the chat list. `scope` is the one perspective, or absent when
/// the session is global.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub scope: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// The open conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveChat {
    pub id: String,
    pub title: String,
    pub scope: Option<String>,
}

/// What the panel paints. No wall-clock field: a test must not depend on
/// "ago".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChatView {
    pub unavailable: Option<String>,
    pub error: Option<String>,
    pub send_failed: Option<String>,
    pub summaries: Vec<ChatSummary>,
    pub active: Option<ActiveChat>,
    pub messages: Vec<ChatTurn>,
    pub draft: String,
    pub space_uuid: Option<String>,
    pub space_name: Option<String>,
}

/// Sync on purpose. Tests and the egui frame call it without a runtime.
/// No generic methods, so it can sit in a `Box`.
pub trait ChatPort: Send {
    fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError>;
    fn messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError>;
    /// Rows with `seq` strictly below `before`, oldest first. The page is
    /// the newest `limit` of those rows, which is how `ai.sessionMessages`
    /// answers `before`.
    fn messages_before(
        &mut self,
        id: &str,
        before: i64,
        limit: u32,
    ) -> Result<Vec<TranscriptRow>, ChatError>;
    fn create(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError>;
    fn send(&mut self, id: &str, text: &str) -> Result<String, ChatError>;
    fn cancel(&mut self, id: &str) -> Result<bool, ChatError>;
    fn delete(&mut self, id: &str) -> Result<(), ChatError>;
    /// `true` when an `ai-session-changed` event arrived since the last call.
    /// The in-memory port has no events.
    fn poll(&mut self) -> bool {
        false
    }
}

/// How many transcript rows one page holds. The executor defaults to this.
pub const MESSAGE_PAGE: u32 = 200;

/// Whether a tool call declares a write. `writes` on the row wins. Otherwise
/// the name's verb decides, and an unknown name is a write. This is intent,
/// not a claim that the call changed the space.
pub fn is_write_tool(tool: &str, writes: Option<bool>) -> bool {
    if let Some(writes) = writes {
        return writes;
    }
    if is_static_read(tool) || has_read_prefix(tool) {
        return false;
    }
    !is_read_verb(verb_of(tool))
}

fn is_static_read(tool: &str) -> bool {
    matches!(
        tool,
        "flow_state"
            | "flow_actions"
            | "flow_valid_outputs"
            | "auth_status"
            | "language_meta"
            | "instance_get"
            | "instance_query"
            | "instance_transcript"
            | "get_children"
    )
}

fn has_read_prefix(tool: &str) -> bool {
    ["list_", "get_", "query_", "describe_"]
        .iter()
        .any(|prefix| tool.starts_with(prefix))
}

fn verb_of(tool: &str) -> &str {
    tool.split('_').nth(1).unwrap_or(tool)
}

fn is_read_verb(verb: &str) -> bool {
    matches!(verb, "get" | "query" | "list")
}

/// A perspective uuid, the shape `perspective.add` hands out. Case
/// insensitive. Length 36. No regex crate: `we-data` does not depend on one.
pub fn plain_uuid(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 36 && uuid_at(bytes, 0)
}

fn uuid_at(bytes: &[u8], start: usize) -> bool {
    if start + 36 > bytes.len() {
        return false;
    }
    for (offset, byte) in bytes[start..start + 36].iter().enumerate() {
        let dash = matches!(offset, 8 | 13 | 18 | 23);
        if dash {
            if *byte != b'-' {
                return false;
            }
        } else if !byte.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

fn uuid_in_text(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    if bytes.len() < 36 {
        return None;
    }
    for start in 0..=bytes.len() - 36 {
        if uuid_at(bytes, start) {
            return Some(&text[start..start + 36]);
        }
    }
    None
}

fn reply_status(status: Option<&str>) -> ReplyStatus {
    match status {
        Some("done") => ReplyStatus::Done,
        Some("failed") => ReplyStatus::Failed,
        Some("cancelled") => ReplyStatus::Cancelled,
        Some("interrupted") => ReplyStatus::Interrupted,
        _ => ReplyStatus::Running,
    }
}

fn nonempty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

fn step_target(content: &RowContent) -> Option<String> {
    if let Some(target) = &content.target {
        return Some(target.clone());
    }
    content.perspective_id.clone()
}

fn step_outcome(status: Option<&str>, reply: ReplyStatus) -> Outcome {
    match status {
        Some("done") => Outcome::Ok,
        Some("failed") => Outcome::Error,
        Some("cancelled") | Some("interrupted") => Outcome::Stopped,
        _ => {
            if reply == ReplyStatus::Running {
                Outcome::Running
            } else {
                Outcome::Stopped
            }
        }
    }
}

/// A short digest of a step result. A JSON array becomes a count. A JSON
/// object becomes nothing. Other JSON is its JS string, 60 scalar values.
/// A non-JSON string longer than 60 keeps 57 and an ellipsis.
pub fn summarize(result: &str) -> Option<String> {
    if result.is_empty() {
        return None;
    }
    match serde_json::from_str::<Json>(result) {
        Ok(Json::Array(items)) => {
            let count = items.len();
            Some(if count == 1 {
                "1 result".to_string()
            } else {
                format!("{count} results")
            })
        }
        Ok(Json::Object(_)) => None,
        Ok(other) => {
            let text = js_string(&other);
            let cut: String = text.chars().take(60).collect();
            (!cut.is_empty()).then_some(cut)
        }
        Err(_) => {
            if result.chars().count() > 60 {
                let head: String = result.chars().take(57).collect();
                Some(format!("{head}…"))
            } else {
                Some(result.to_string())
            }
        }
    }
}

fn js_string(value: &Json) -> String {
    match value {
        Json::Null => "null".to_string(),
        Json::Bool(true) => "true".to_string(),
        Json::Bool(false) => "false".to_string(),
        Json::Number(number) => {
            if let Some(int) = number.as_i64() {
                int.to_string()
            } else if let Some(uint) = number.as_u64() {
                uint.to_string()
            } else {
                number.to_string()
            }
        }
        Json::String(text) => text.clone(),
        Json::Array(_) | Json::Object(_) => String::new(),
    }
}

fn to_step(row: &TranscriptRow, reply: ReplyStatus) -> ChatStep {
    let name = row
        .content
        .name
        .clone()
        .unwrap_or_else(|| "tool".to_string());
    let outcome = step_outcome(row.status.as_deref(), reply);
    let error = nonempty(row.error.as_deref())
        .or_else(|| nonempty(row.content.error.as_deref()))
        .map(str::to_string);
    let refused =
        outcome == Outcome::Error && error.as_deref().unwrap_or("").contains(CAPABILITY_REFUSAL);
    let summary = row.content.result.as_deref().and_then(summarize);
    ChatStep {
        writes: is_write_tool(&name, row.content.writes),
        name,
        target: step_target(&row.content),
        outcome,
        refused,
        error,
        summary,
    }
}

/// Neutral turns, oldest first. Each reply keeps only the tool rows that
/// follow it. A user row clears the current reply. A tool row before any
/// reply is dropped.
pub fn conversation_of(rows: &[TranscriptRow]) -> Vec<ChatTurn> {
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_by(|&a, &b| rows[a].seq.cmp(&rows[b].seq).then(a.cmp(&b)));
    let mut out: Vec<ChatTurn> = Vec::new();
    let mut reply_at: Option<usize> = None;
    for index in order {
        let row = &rows[index];
        match row.role {
            TranscriptRole::User => {
                reply_at = None;
                out.push(ChatTurn {
                    id: row.id.clone(),
                    role: TurnRole::User,
                    text: row.content.text.clone().unwrap_or_default(),
                    created_at_ms: row.created_at_ms,
                    status: None,
                    error: None,
                    refused: false,
                    steps: Vec::new(),
                });
            }
            TranscriptRole::Assistant => {
                let status = reply_status(row.status.as_deref());
                let error = nonempty(row.error.as_deref()).map(str::to_string);
                let refused = status != ReplyStatus::Running
                    && error.as_deref().unwrap_or("").contains(CAPABILITY_REFUSAL);
                out.push(ChatTurn {
                    id: row.id.clone(),
                    role: TurnRole::Assistant,
                    text: row.content.text.clone().unwrap_or_default(),
                    created_at_ms: row.created_at_ms,
                    status: Some(status),
                    error,
                    refused,
                    steps: Vec::new(),
                });
                reply_at = Some(out.len() - 1);
            }
            TranscriptRole::Tool => {
                if let Some(index) = reply_at {
                    let status = out[index].status.unwrap_or(ReplyStatus::Running);
                    let step = to_step(row, status);
                    out[index].steps.push(step);
                }
            }
        }
    }
    out
}

/// The one perspective a session is pinned to. Absent means global.
/// Every cap must be domain `perspective`, exactly one non-`*` pointer,
/// and a non-empty `can` whose verbs are all in [`SCOPED_CAN`]. The
/// pointers must all be the same uuid. `default_perspective` is ignored.
pub fn scope_of(session: &SessionHead) -> Option<String> {
    let _ignored = &session.default_perspective;
    let mut uuid: Option<String> = None;
    for cap in &session.capabilities {
        if cap.domain != "perspective" {
            return None;
        }
        if cap.pointers.len() != 1 || cap.pointers[0] == "*" {
            return None;
        }
        if cap.can.is_empty()
            || cap
                .can
                .iter()
                .any(|verb| !SCOPED_CAN.contains(&verb.as_str()))
        {
            return None;
        }
        let pointer = &cap.pointers[0];
        match &uuid {
            None => uuid = Some(pointer.clone()),
            Some(current) if current != pointer => return None,
            Some(_) => {}
        }
    }
    uuid
}

/// A reply is still working. That swaps Send for Stop.
pub fn reply_running(messages: &[ChatTurn]) -> bool {
    messages.iter().any(|message| {
        message.role == TurnRole::Assistant && message.status == Some(ReplyStatus::Running)
    })
}

/// The text the last user turn asked with.
pub fn last_ask(messages: &[ChatTurn]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| message.role == TurnRole::User)
        .map(|message| message.text.clone())
        .unwrap_or_default()
}

/// The user text before `reply_id`. Empty when the reply is missing or
/// no user turn precedes it.
pub fn ask_before(messages: &[ChatTurn], reply_id: &str) -> String {
    let Some(at) = messages.iter().position(|message| message.id == reply_id) else {
        return String::new();
    };
    messages[..at]
        .iter()
        .rev()
        .find(|message| message.role == TurnRole::User)
        .map(|message| message.text.clone())
        .unwrap_or_default()
}

fn reached_outside(step: &ChatStep, perspective_uuid: Option<&str>) -> bool {
    // An empty scope is the global chat: every refusal is the account boundary.
    let Some(perspective) = perspective_uuid.filter(|uuid| !uuid.is_empty()) else {
        return true;
    };
    // `target` first. The error text dumps the session's own capabilities,
    // so a uuid found there is the chat's own perspective.
    let named = if let Some(target) = &step.target {
        Some(target.as_str())
    } else {
        step.error.as_deref().and_then(uuid_in_text)
    };
    match named {
        Some(named) => !named.eq_ignore_ascii_case(perspective),
        None => false,
    }
}

/// The capability refusal the last settled reply ended on.
pub fn refusal_of(messages: &[ChatTurn], perspective_uuid: Option<&str>) -> Option<String> {
    let reply = messages.iter().rev().find(|message| {
        message.role == TurnRole::Assistant
            && message.status.is_some()
            && message.status != Some(ReplyStatus::Running)
    })?;
    if reply.refused
        || reply
            .error
            .as_deref()
            .unwrap_or("")
            .contains(CAPABILITY_REFUSAL)
    {
        return Some(
            reply
                .error
                .clone()
                .unwrap_or_else(|| CAPABILITY_REFUSAL.to_string()),
        );
    }
    reply
        .steps
        .iter()
        .find(|step| step.refused && reached_outside(step, perspective_uuid))
        .map(|step| {
            step.error
                .clone()
                .unwrap_or_else(|| CAPABILITY_REFUSAL.to_string())
        })
}

/// The refusal card's sentence. The em dash is the TS string, kept as data.
pub fn refusal_sentence(space_name: Option<&str>, scoped: bool) -> String {
    if !scoped {
        return "The chat was refused access — it reached for something this account may not use."
            .to_string();
    }
    let name = space_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("this space");
    format!("This chat can only use {name}. It was refused access to another space.")
}

/// How a reply that did not finish ended, in the words the chat says.
pub fn unfinished_words(status: ReplyStatus) -> Option<&'static str> {
    match status {
        ReplyStatus::Failed => Some("The reply failed"),
        ReplyStatus::Cancelled => Some("Stopped"),
        ReplyStatus::Interrupted => Some("Stopped when the node restarted"),
        ReplyStatus::Running | ReplyStatus::Done => None,
    }
}

/// What [`ChatModel::send`] stores when a space id is not a uuid.
pub fn bad_scope_message(uuid: &str) -> String {
    format!("a space chat needs a perspective uuid; \"{uuid}\" is not one")
}

/// What a read-only window stores when a send is refused locally.
pub fn read_only_chat_message(space: Option<&str>) -> String {
    match space {
        Some(uuid) => format!(
            "This window is read-only. Start it with --write --space {uuid} to send in this chat."
        ),
        None => "This window is read-only. A read-only chat cannot send.".to_string(),
    }
}

/// What a send stores when the open session is not the host's space.
pub const FOREIGN_CHAT: &str = "This chat is not in the open space.";

/// The line the panel paints for a step. A declared write stays visible
/// when the call fails, and the words do not say the space changed.
pub fn step_label(step: &ChatStep) -> String {
    if !step.writes {
        return step.name.clone();
    }
    let word = match step.outcome {
        Outcome::Running => "running",
        Outcome::Ok => "done",
        Outcome::Error => "failed",
        Outcome::Stopped => "stopped",
    };
    format!("{} · write operation · {word}", step.name)
}

/// The perspective cap a "this space only" chat is created with.
/// The verbs are the ones the write grant holds, not every scoped verb.
pub fn space_cap(uuid: &str) -> ChatCap {
    ChatCap {
        domain: "perspective".to_string(),
        pointers: vec![uuid.to_string()],
        can: HELD_CAN.iter().map(|verb| (*verb).to_string()).collect(),
    }
}

#[derive(Debug)]
struct MemSession {
    id: String,
    title: String,
    capabilities: Vec<ChatCap>,
    created_at_ms: i64,
    updated_at_ms: i64,
    rows: Vec<TranscriptRow>,
    next_seq: i64,
}

/// An in-memory [`ChatPort`]. `send` appends a user row and a running
/// assistant row, the way `sessionSend` returns before the reply settles.
/// `sends` records `(session id, text)` so a test can see that a later
/// send stayed on the id a web session already had.
#[derive(Debug)]
pub struct MemoryChat {
    sessions: Vec<MemSession>,
    next_id: u64,
    tick_ms: i64,
    fail_next_send: bool,
    fail_next_read: bool,
    fail_next_list: bool,
    unavailable: Option<String>,
    /// Every successful `create`, in order. A refused scope does not count.
    pub creates: u32,
    /// The scope passed to each successful `create`. `None` is global.
    pub created: Vec<Option<String>>,
    pub sends: Vec<(String, String)>,
    /// Every `cancel` call, including one that finds no session.
    pub cancels: u32,
    /// Every `delete` call, including one that finds no session.
    pub deletes: u32,
}

impl MemoryChat {
    pub fn new() -> Self {
        Self {
            sessions: Vec::new(),
            next_id: 0,
            tick_ms: 0,
            fail_next_send: false,
            fail_next_read: false,
            fail_next_list: false,
            unavailable: None,
            creates: 0,
            created: Vec::new(),
            sends: Vec::new(),
            cancels: 0,
            deletes: 0,
        }
    }

    fn tick(&mut self) -> i64 {
        self.tick_ms += 1;
        self.tick_ms
    }

    /// The next `send` fails once and writes nothing.
    pub fn fail_next(&mut self) {
        self.fail_next_send = true;
    }

    /// The next `messages` read fails once and returns nothing.
    pub fn fail_next_read(&mut self) {
        self.fail_next_read = true;
    }

    /// The next `list` fails once and returns nothing.
    pub fn fail_next_list(&mut self) {
        self.fail_next_list = true;
    }

    /// Replace the session's perspective caps. The model's cached scope
    /// stays until it reads the list again.
    pub fn retarget(&mut self, id: &str, scope: Option<&str>) {
        let Some(session) = self.sessions.iter_mut().find(|session| session.id == id) else {
            return;
        };
        session.capabilities = match scope {
            Some(uuid) => vec![space_cap(uuid)],
            None => Vec::new(),
        };
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// One settled exchange, as web We would already have written it.
    pub fn seed(
        &mut self,
        id: &str,
        title: &str,
        updated_at_ms: i64,
        user_text: &str,
        reply_text: &str,
    ) {
        self.sessions.push(MemSession {
            id: id.to_string(),
            title: title.to_string(),
            capabilities: Vec::new(),
            created_at_ms: updated_at_ms.saturating_sub(1),
            updated_at_ms,
            next_seq: 3,
            rows: vec![
                TranscriptRow {
                    id: format!("{id}-u"),
                    seq: 1,
                    role: TranscriptRole::User,
                    content: RowContent {
                        text: Some(user_text.to_string()),
                        ..RowContent::default()
                    },
                    status: None,
                    error: None,
                    created_at_ms: 1,
                },
                TranscriptRow {
                    id: format!("{id}-a"),
                    seq: 2,
                    role: TranscriptRole::Assistant,
                    content: RowContent {
                        text: Some(reply_text.to_string()),
                        ..RowContent::default()
                    },
                    status: Some("done".to_string()),
                    error: None,
                    created_at_ms: 2,
                },
            ],
        });
    }

    fn guard(&self) -> Result<(), ChatError> {
        if let Some(message) = &self.unavailable {
            return Err(ChatError::Unavailable(message.clone()));
        }
        Ok(())
    }

    fn list_sessions(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
        self.guard()?;
        if self.fail_next_list {
            self.fail_next_list = false;
            return Err(ChatError::Failed("list failed".to_string()));
        }
        let mut rows: Vec<ChatSummary> = self
            .sessions
            .iter()
            .map(|session| ChatSummary {
                id: session.id.clone(),
                title: session.title.clone(),
                scope: scope_of(&SessionHead {
                    capabilities: session.capabilities.clone(),
                    default_perspective: None,
                }),
                created_at_ms: session.created_at_ms,
                updated_at_ms: session.updated_at_ms,
            })
            .collect();
        rows.sort_by(|a, b| {
            b.updated_at_ms
                .cmp(&a.updated_at_ms)
                .then(b.created_at_ms.cmp(&a.created_at_ms))
                .then(b.id.cmp(&a.id))
        });
        Ok(rows)
    }

    fn read_messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
        self.guard()?;
        if self.fail_next_read {
            self.fail_next_read = false;
            return Err(ChatError::Failed("read failed".to_string()));
        }
        self.sessions
            .iter()
            .find(|session| session.id == id)
            .map(|session| session.rows.clone())
            .ok_or_else(|| ChatError::Failed(format!("no chat {id}")))
    }

    /// The newest `limit` rows older than `before`, oldest first.
    fn page_before(
        &mut self,
        id: &str,
        before: i64,
        limit: u32,
    ) -> Result<Vec<TranscriptRow>, ChatError> {
        let mut rows = self.read_messages(id)?;
        rows.retain(|row| row.seq < before);
        rows.sort_by_key(|row| row.seq);
        let keep = limit as usize;
        if rows.len() > keep {
            rows = rows.split_off(rows.len() - keep);
        }
        Ok(rows)
    }

    fn create_session(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError> {
        self.guard()?;
        if let Some(uuid) = scope {
            if !plain_uuid(uuid) {
                return Err(ChatError::Failed(bad_scope_message(uuid)));
            }
        }
        self.creates += 1;
        self.created.push(scope.map(str::to_string));
        self.next_id += 1;
        let id = format!("sess-{}", self.next_id);
        let now = self.tick();
        let capabilities = match scope {
            Some(uuid) => vec![space_cap(uuid)],
            None => Vec::new(),
        };
        self.sessions.push(MemSession {
            id: id.clone(),
            title: title.to_string(),
            capabilities,
            created_at_ms: now,
            updated_at_ms: now,
            rows: Vec::new(),
            next_seq: 1,
        });
        Ok(id)
    }

    fn send_text(&mut self, id: &str, text: &str) -> Result<String, ChatError> {
        self.guard()?;
        if self.fail_next_send {
            self.fail_next_send = false;
            return Err(ChatError::Failed("send failed".to_string()));
        }
        let now = self.tick();
        let session = self
            .sessions
            .iter_mut()
            .find(|session| session.id == id)
            .ok_or_else(|| ChatError::Failed(format!("no chat {id}")))?;
        let user_seq = session.next_seq;
        session.next_seq += 1;
        let reply_seq = session.next_seq;
        session.next_seq += 1;
        session.rows.push(TranscriptRow {
            id: format!("{id}-u{user_seq}"),
            seq: user_seq,
            role: TranscriptRole::User,
            content: RowContent {
                text: Some(text.to_string()),
                ..RowContent::default()
            },
            status: None,
            error: None,
            created_at_ms: now,
        });
        let reply_id = format!("{id}-a{reply_seq}");
        session.rows.push(TranscriptRow {
            id: reply_id.clone(),
            seq: reply_seq,
            role: TranscriptRole::Assistant,
            content: RowContent {
                text: Some(String::new()),
                ..RowContent::default()
            },
            status: Some("running".to_string()),
            error: None,
            created_at_ms: now,
        });
        session.updated_at_ms = now;
        self.sends.push((id.to_string(), text.to_string()));
        Ok(reply_id)
    }

    fn cancel_session(&mut self, id: &str) -> Result<bool, ChatError> {
        self.cancels += 1;
        self.guard()?;
        let now = self.tick();
        let session = self
            .sessions
            .iter_mut()
            .find(|session| session.id == id)
            .ok_or_else(|| ChatError::Failed(format!("no chat {id}")))?;
        let mut stopped = false;
        for row in &mut session.rows {
            if row.role == TranscriptRole::Assistant && row.status.as_deref() == Some("running") {
                row.status = Some("cancelled".to_string());
                stopped = true;
            }
        }
        if stopped {
            session.updated_at_ms = now;
        }
        Ok(stopped)
    }

    fn delete_session(&mut self, id: &str) -> Result<(), ChatError> {
        self.deletes += 1;
        self.guard()?;
        let before = self.sessions.len();
        self.sessions.retain(|session| session.id != id);
        if self.sessions.len() == before {
            return Err(ChatError::Failed(format!("no chat {id}")));
        }
        Ok(())
    }
}

impl Default for MemoryChat {
    fn default() -> Self {
        Self::new()
    }
}

impl ChatPort for MemoryChat {
    fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
        self.list_sessions()
    }
    fn messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
        self.read_messages(id)
    }
    fn messages_before(
        &mut self,
        id: &str,
        before: i64,
        limit: u32,
    ) -> Result<Vec<TranscriptRow>, ChatError> {
        self.page_before(id, before, limit)
    }
    fn create(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError> {
        self.create_session(title, scope)
    }
    fn send(&mut self, id: &str, text: &str) -> Result<String, ChatError> {
        self.send_text(id, text)
    }
    fn cancel(&mut self, id: &str) -> Result<bool, ChatError> {
        self.cancel_session(id)
    }
    fn delete(&mut self, id: &str) -> Result<(), ChatError> {
        self.delete_session(id)
    }
}

impl ChatPort for Arc<Mutex<MemoryChat>> {
    fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .list_sessions()
    }
    fn messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .read_messages(id)
    }
    fn messages_before(
        &mut self,
        id: &str,
        before: i64,
        limit: u32,
    ) -> Result<Vec<TranscriptRow>, ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .page_before(id, before, limit)
    }
    fn create(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .create_session(title, scope)
    }
    fn send(&mut self, id: &str, text: &str) -> Result<String, ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .send_text(id, text)
    }
    fn cancel(&mut self, id: &str) -> Result<bool, ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .cancel_session(id)
    }
    fn delete(&mut self, id: &str) -> Result<(), ChatError> {
        self.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .delete_session(id)
    }
}

/// Whether the host lets this window change chats.
///
/// Read-only still lists and opens. Create, send, cancel, and delete are
/// refused here, so a broader token cannot change a chat from this window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChatAccess {
    #[default]
    ReadOnly,
    Write,
}

/// The host's chat authority. The template does not choose it.
///
/// [`ChatAuthority::space`] is the open perspective. [`ChatAuthority::global`]
/// is a host-authorized chat with no space. A space window passes the space
/// the host opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatAuthority {
    space: Option<String>,
    name: Option<String>,
    access: ChatAccess,
}

impl ChatAuthority {
    pub fn space(uuid: impl Into<String>, name: Option<String>, access: ChatAccess) -> Self {
        Self {
            space: Some(uuid.into()).filter(|value| !value.is_empty()),
            name: name.filter(|value| !value.is_empty()),
            access,
        }
    }

    /// A host-authorized chat that is not pinned to one space.
    pub fn global(access: ChatAccess) -> Self {
        Self {
            space: None,
            name: None,
            access,
        }
    }
}

/// The panel's state. `send` on an open session uses that session's id.
/// A first send, with nothing open, creates a session and then sends on it.
/// The scope is [`ChatAuthority`], not a template input.
pub struct ChatModel {
    port: Box<dyn ChatPort + Send>,
    authority: ChatAuthority,
    pub view: ChatView,
    sending: bool,
    prefilled: bool,
}

impl ChatModel {
    /// A host-authorized global chat that may send.
    pub fn new(port: Box<dyn ChatPort + Send>) -> Self {
        Self::bound(port, ChatAuthority::global(ChatAccess::Write))
    }

    /// `authority` is the open space and the window's access.
    pub fn bound(port: Box<dyn ChatPort + Send>, authority: ChatAuthority) -> Self {
        let view = ChatView {
            space_uuid: authority.space.clone(),
            space_name: authority.name.clone(),
            ..ChatView::default()
        };
        let mut model = Self {
            port,
            authority,
            view,
            sending: false,
            prefilled: false,
        };
        model.refresh();
        model
    }

    pub fn set_draft(&mut self, draft: String) {
        self.view.draft = draft;
    }

    /// The panel's `prefill`, applied once, and only when the field is empty.
    pub fn prefill_once(&mut self, text: &str) {
        if self.prefilled || text.is_empty() {
            return;
        }
        self.prefilled = true;
        if self.view.draft.is_empty() {
            self.view.draft = text.to_string();
        }
    }

    pub fn open(&mut self, id: &str) {
        let Some(summary) = self.view.summaries.iter().find(|row| row.id == id).cloned() else {
            self.view.error = Some(format!("no chat {id}"));
            return;
        };
        if !self.allows(summary.scope.as_deref()) {
            self.view.error = Some(FOREIGN_CHAT.to_string());
            return;
        }
        // Drop the previous transcript before the read. A failed read of B
        // must not leave A's messages under B.
        self.view.messages.clear();
        self.view.active = Some(ActiveChat {
            id: summary.id,
            title: summary.title,
            scope: summary.scope,
        });
        self.view.send_failed = None;
        self.view.error = None;
        self.load();
    }

    pub fn back(&mut self) {
        self.view.active = None;
        self.view.messages.clear();
        self.view.send_failed = None;
        self.refresh();
    }

    /// Reload the list, then the open transcript, when the port saw
    /// `ai-session-changed`. Returns whether it did. A session that left
    /// the list is closed. A failed read of the same session keeps the
    /// transcript.
    pub fn follow(&mut self) -> bool {
        if !self.port.poll() {
            return false;
        }
        let active_id = self.view.active.as_ref().map(|active| active.id.clone());
        self.refresh();
        if let Some(id) = active_id {
            if self.view.summaries.iter().any(|row| row.id == id) {
                self.load();
            } else {
                self.view.active = None;
                self.view.messages.clear();
                self.view.send_failed = None;
            }
        }
        true
    }

    pub fn send(&mut self) {
        if self.sending || reply_running(&self.view.messages) {
            return;
        }
        let text = self.view.draft.trim().to_string();
        if text.is_empty() {
            return;
        }
        let active_id = self.view.active.as_ref().map(|active| active.id.clone());
        if let Some(message) = self.gate_mutation(active_id.as_deref()) {
            self.view.send_failed = Some(message);
            return;
        }
        self.sending = true;
        self.view.send_failed = None;
        self.view.draft.clear();
        let outcome = if let Some(active) = self.view.active.clone() {
            self.port.send(&active.id, &text).map(|_| active)
        } else {
            self.start_and_send(&text)
        };
        match outcome {
            Ok(active) => {
                self.view.active = Some(active);
                self.load();
                self.refresh();
            }
            Err(ChatError::Unavailable(message)) => {
                self.view.unavailable = Some(message);
                self.view.draft = text;
            }
            Err(ChatError::Failed(message)) => {
                self.view.send_failed = Some(message);
                self.view.draft = text;
            }
        }
        self.sending = false;
    }

    /// "Send again" for one reply's question. The composer draft stays.
    pub fn resend(&mut self, question: &str) {
        if self.sending || reply_running(&self.view.messages) {
            return;
        }
        let Some(active) = self.view.active.clone() else {
            return;
        };
        let text = question.trim().to_string();
        if text.is_empty() {
            return;
        }
        if let Some(message) = self.gate_mutation(Some(&active.id)) {
            self.view.send_failed = Some(message);
            return;
        }
        self.sending = true;
        self.view.send_failed = None;
        match self.port.send(&active.id, &text) {
            Ok(_) => {
                self.load();
                self.refresh();
            }
            Err(ChatError::Unavailable(message)) => self.view.unavailable = Some(message),
            Err(ChatError::Failed(message)) => self.view.send_failed = Some(message),
        }
        self.sending = false;
    }

    pub fn cancel(&mut self) {
        let Some(id) = self.view.active.as_ref().map(|active| active.id.clone()) else {
            return;
        };
        if let Some(message) = self.gate_mutation(Some(&id)) {
            self.view.error = Some(message);
            return;
        }
        match self.port.cancel(&id) {
            Ok(_) => self.load(),
            Err(ChatError::Unavailable(message)) => self.view.unavailable = Some(message),
            Err(ChatError::Failed(message)) => self.view.error = Some(message),
        }
    }

    pub fn delete(&mut self, id: &str) {
        if let Some(message) = self.gate_mutation(Some(id)) {
            self.view.error = Some(message);
            return;
        }
        match self.port.delete(id) {
            Ok(()) => {
                if self
                    .view
                    .active
                    .as_ref()
                    .is_some_and(|active| active.id == id)
                {
                    self.view.active = None;
                    self.view.messages.clear();
                }
                self.refresh();
            }
            Err(ChatError::Unavailable(message)) => self.view.unavailable = Some(message),
            Err(ChatError::Failed(message)) => self.view.error = Some(message),
        }
    }

    fn start_and_send(&mut self, text: &str) -> Result<ActiveChat, ChatError> {
        let scope = self.authority.space.clone();
        let title: String = text.chars().take(60).collect();
        let id = self.port.create(&title, scope.as_deref())?;
        let active = ActiveChat {
            id: id.clone(),
            title,
            scope,
        };
        self.view.active = Some(active.clone());
        self.port.send(&id, text)?;
        Ok(active)
    }

    /// Why this mutation must not touch the port. `None` means it may.
    ///
    /// An open session is read from `list` again. The cached scope is not
    /// enough: a failed list refuses, and a session that moved is refused.
    fn gate_mutation(&mut self, id: Option<&str>) -> Option<String> {
        if self.authority.access != ChatAccess::Write {
            return Some(read_only_chat_message(self.authority.space.as_deref()));
        }
        if let Some(uuid) = &self.authority.space {
            if !plain_uuid(uuid) {
                return Some(bad_scope_message(uuid));
            }
        }
        let id = id?;
        let rows = match self.port.list() {
            Ok(rows) => rows,
            Err(ChatError::Unavailable(message) | ChatError::Failed(message)) => {
                return Some(message);
            }
        };
        let Some(row) = rows.into_iter().find(|row| row.id == id) else {
            return Some(FOREIGN_CHAT.to_string());
        };
        if !self.allows(row.scope.as_deref()) {
            return Some(FOREIGN_CHAT.to_string());
        }
        if let Some(active) = &mut self.view.active {
            if active.id == id {
                active.scope = row.scope;
            }
        }
        None
    }

    fn allows(&self, scope: Option<&str>) -> bool {
        match self.authority.space.as_deref() {
            Some(uuid) => scope == Some(uuid),
            None => scope.is_none(),
        }
    }

    fn refresh(&mut self) {
        match self.port.list() {
            Ok(rows) => {
                self.view.summaries = rows
                    .into_iter()
                    .filter(|row| self.allows(row.scope.as_deref()))
                    .collect();
                self.view.unavailable = None;
            }
            Err(ChatError::Unavailable(message)) => {
                self.view.unavailable = Some(message);
                self.view.summaries.clear();
            }
            Err(ChatError::Failed(message)) => self.view.error = Some(message),
        }
    }

    fn load(&mut self) {
        let Some(id) = self.view.active.as_ref().map(|active| active.id.clone()) else {
            return;
        };
        match self.full_transcript(&id) {
            Ok(rows) => {
                self.view.messages = conversation_of(&rows);
                self.view.error = None;
            }
            Err(ChatError::Unavailable(message)) => self.view.unavailable = Some(message),
            Err(ChatError::Failed(message)) => self.view.error = Some(message),
        }
    }

    /// The newest page, then older pages until one comes back short.
    /// Rows are kept by id. A failed read leaves the caller to keep the
    /// previous transcript.
    fn full_transcript(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
        let mut rows = self.port.messages(id)?;
        while let Some(oldest) = rows.iter().map(|row| row.seq).min() {
            let page = self.port.messages_before(id, oldest, MESSAGE_PAGE)?;
            if page.is_empty() {
                break;
            }
            let mut known: HashSet<String> = rows.iter().map(|row| row.id.clone()).collect();
            let mut added = 0usize;
            for row in page {
                if known.insert(row.id.clone()) {
                    rows.push(row);
                    added += 1;
                }
            }
            if added == 0 || added < MESSAGE_PAGE as usize {
                break;
            }
            if rows.iter().map(|row| row.seq).min().unwrap_or(oldest) >= oldest {
                break;
            }
        }
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPACE_A: &str = "a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2";
    const SPACE_B: &str = "b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2";

    fn text_row(id: &str, seq: i64, role: TranscriptRole, text: &str) -> TranscriptRow {
        TranscriptRow {
            id: id.to_string(),
            seq,
            role,
            content: RowContent {
                text: Some(text.to_string()),
                ..RowContent::default()
            },
            status: None,
            error: None,
            created_at_ms: seq,
        }
    }

    fn assistant(
        id: &str,
        seq: i64,
        text: &str,
        status: &str,
        error: Option<&str>,
    ) -> TranscriptRow {
        TranscriptRow {
            id: id.to_string(),
            seq,
            role: TranscriptRole::Assistant,
            content: RowContent {
                text: Some(text.to_string()),
                ..RowContent::default()
            },
            status: Some(status.to_string()),
            error: error.map(str::to_string),
            created_at_ms: seq,
        }
    }

    fn tool(
        id: &str,
        seq: i64,
        content: RowContent,
        status: &str,
        error: Option<&str>,
    ) -> TranscriptRow {
        TranscriptRow {
            id: id.to_string(),
            seq,
            role: TranscriptRole::Tool,
            content,
            status: Some(status.to_string()),
            error: error.map(str::to_string),
            created_at_ms: seq,
        }
    }

    fn named(name: &str) -> RowContent {
        RowContent {
            name: Some(name.to_string()),
            ..RowContent::default()
        }
    }

    fn cap(domain: &str, pointers: &[&str], can: &[&str]) -> ChatCap {
        ChatCap {
            domain: domain.to_string(),
            pointers: pointers.iter().map(|p| (*p).to_string()).collect(),
            can: can.iter().map(|verb| (*verb).to_string()).collect(),
        }
    }

    fn head(caps: Vec<ChatCap>, default_perspective: Option<&str>) -> SessionHead {
        SessionHead {
            capabilities: caps,
            default_perspective: default_perspective.map(str::to_string),
        }
    }

    fn scoped_can() -> Vec<&'static str> {
        vec!["READ", "CREATE", "UPDATE", "DELETE", "SUBSCRIBE"]
    }

    fn model_with(seed: Option<(&str, &str, &str, &str)>) -> (ChatModel, Arc<Mutex<MemoryChat>>) {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        if let Some((id, title, user, reply)) = seed {
            mem.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .seed(id, title, 2, user, reply);
        }
        let model = ChatModel::new(Box::new(mem.clone()));
        (model, mem)
    }

    #[test]
    fn conversation_turns_keep_each_replys_own_steps() {
        let first = conversation_of(&[
            tool("early", 0, named("dropped"), "done", None),
            text_row("u2", 5, TranscriptRole::User, "thanks"),
            assistant("a1", 2, "A new task.", "done", None),
            text_row("u1", 1, TranscriptRole::User, "what changed?"),
            tool("t2", 4, named("instance_create"), "done", None),
            tool("t1", 3, named("describe_perspective"), "done", None),
            assistant("a2", 6, "Any time.", "done", None),
        ]);
        assert_eq!(
            first.iter().map(|turn| turn.role).collect::<Vec<_>>(),
            vec![
                TurnRole::User,
                TurnRole::Assistant,
                TurnRole::User,
                TurnRole::Assistant
            ]
        );
        assert_eq!(first[1].text, "A new task.");
        assert_eq!(first[1].status, Some(ReplyStatus::Done));
        assert_eq!(
            first[1]
                .steps
                .iter()
                .map(|step| step.name.as_str())
                .collect::<Vec<_>>(),
            vec!["describe_perspective", "instance_create"]
        );
        assert!(first[3].steps.is_empty());

        let split = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("fail", 2, "", "failed", None),
            tool("t", 3, named("instance_create"), "done", None),
            assistant("ok", 4, "done this time", "done", None),
            tool("link", 5, named("add_link"), "done", None),
        ]);
        assert_eq!(
            split[1]
                .steps
                .iter()
                .map(|step| step.name.as_str())
                .collect::<Vec<_>>(),
            vec!["instance_create"]
        );
        assert_eq!(
            split[2]
                .steps
                .iter()
                .map(|step| step.name.as_str())
                .collect::<Vec<_>>(),
            vec!["add_link"]
        );
    }

    #[test]
    fn reply_status_and_step_outcome() {
        let failed = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "", "failed", Some("model exploded")),
        ]);
        assert_eq!(failed[1].status, Some(ReplyStatus::Failed));
        assert_eq!(failed[1].error.as_deref(), Some("model exploded"));

        for (given, want) in [
            ("running", ReplyStatus::Running),
            ("cancelled", ReplyStatus::Cancelled),
            ("interrupted", ReplyStatus::Interrupted),
            ("something-new", ReplyStatus::Running),
        ] {
            let turns = conversation_of(&[
                text_row("u", 1, TranscriptRole::User, "q"),
                assistant("a", 2, "", given, None),
            ]);
            assert_eq!(turns[1].status, Some(want), "{given}");
        }

        let stopped = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "done", "done", None),
            tool("t", 3, named("query_links"), "running", None),
        ]);
        assert_eq!(stopped[1].steps[0].outcome, Outcome::Stopped);

        let running = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "", "running", None),
            tool("t", 3, named("query_links"), "running", None),
        ]);
        assert_eq!(running[1].steps[0].outcome, Outcome::Running);

        let mut refused_content = named("describe_perspective");
        refused_content.perspective_id = Some("other-space".to_string());
        refused_content.result = Some("[1,2,3]".to_string());
        let refused = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "I cannot.", "done", None),
            tool(
                "t",
                3,
                refused_content,
                "failed",
                Some("Capability is not matched"),
            ),
        ]);
        let step = &refused[1].steps[0];
        assert_eq!(step.outcome, Outcome::Error);
        assert!(step.refused);
        assert_eq!(step.error.as_deref(), Some("Capability is not matched"));
        assert_eq!(step.target.as_deref(), Some("other-space"));
        assert_eq!(step.summary.as_deref(), Some("3 results"));

        let mut object = named("instance_query");
        object.result = Some("{}".to_string());
        let mut plain = named("get_links");
        plain.result = Some("x".repeat(70));
        let digests = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "", "done", None),
            tool("obj", 3, object, "done", None),
            tool("plain", 4, plain, "done", None),
        ]);
        assert_eq!(digests[1].steps[0].summary, None);
        let long = format!("{}…", "x".repeat(57));
        assert_eq!(digests[1].steps[1].summary.as_deref(), Some(long.as_str()));
        assert_eq!(summarize("[1]").as_deref(), Some("1 result"));
        assert_eq!(summarize("null").as_deref(), Some("null"));
    }

    #[test]
    fn write_flag_comes_from_the_row_or_the_verb() {
        assert!(is_write_tool("space_get_name", Some(true)));
        assert!(!is_write_tool("instance_create", Some(false)));
        assert!(!is_write_tool("readmarker_create", Some(false)));
        for read in [
            "list_perspectives",
            "get_links",
            "query_links",
            "describe_perspective",
            "instance_query",
            "instance_transcript",
            "get_children",
            "flow_state",
            "flow_actions",
            "flow_valid_outputs",
            "auth_status",
            "language_meta",
        ] {
            assert!(!is_write_tool(read, None), "{read}");
        }
        for read in [
            "textblock_query",
            "space_get_name",
            "channel_list",
            "readmarker_query",
        ] {
            assert!(!is_write_tool(read, None), "{read}");
        }
        for write in [
            "readmarker_create",
            "listing_create",
            "hashtag_create",
            "textblock_set_title",
            "channel_add_member",
            "note_remove_tag",
            "space_delete",
            "new_tool_x",
            "mystery",
        ] {
            assert!(is_write_tool(write, None), "{write}");
        }

        let mut forced_write = named("space_get_name");
        forced_write.writes = Some(true);
        let mut forced_read = named("instance_create");
        forced_read.writes = Some(false);
        let turns = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "made it", "done", None),
            tool("w", 3, named("instance_create"), "done", None),
            tool("link", 4, named("add_link"), "done", None),
            tool("list", 5, named("list_perspectives"), "done", None),
            tool("flag-w", 6, forced_write, "done", None),
            tool("flag-r", 7, forced_read, "done", None),
            tool(
                "failed-write",
                8,
                named("space_delete"),
                "failed",
                Some("no"),
            ),
        ]);
        let writes: Vec<bool> = turns[1].steps.iter().map(|step| step.writes).collect();
        assert_eq!(writes, vec![true, true, false, true, false, true]);
        assert_eq!(
            step_label(&turns[1].steps[0]),
            "instance_create · write operation · done"
        );
        assert_eq!(
            step_label(&turns[1].steps[5]),
            "space_delete · write operation · failed"
        );
        assert!(!step_label(&turns[1].steps[5]).contains("wrote"));
    }

    #[test]
    fn scope_of_one_perspective() {
        assert!(plain_uuid(SPACE_A));
        assert!(plain_uuid(&SPACE_A.to_ascii_uppercase()));
        assert!(!plain_uuid("*"));
        assert!(!plain_uuid(""));
        assert!(!plain_uuid(&SPACE_A[..35]));

        let full = scoped_can();
        assert_eq!(
            scope_of(&head(
                vec![cap("perspective", &[SPACE_A], &full)],
                Some(SPACE_B)
            ))
            .as_deref(),
            Some(SPACE_A)
        );
        assert_eq!(scope_of(&head(vec![], None)), None);
        assert_eq!(
            scope_of(&head(
                vec![
                    cap("perspective", &["*"], &["CREATE"]),
                    cap("perspective", &["*"], &["READ"]),
                ],
                None
            )),
            None
        );
        assert_eq!(scope_of(&head(vec![cap("*", &["*"], &["*"])], None)), None);
        assert_eq!(
            scope_of(&head(
                vec![
                    cap("perspective", &[SPACE_A], &["READ"]),
                    cap("perspective", &[SPACE_B], &["UPDATE"]),
                ],
                None
            )),
            None
        );
        assert_eq!(
            scope_of(&head(
                vec![
                    cap("perspective", &[SPACE_A], &full),
                    cap("agent", &["*"], &["READ"]),
                ],
                Some(SPACE_A)
            )),
            None
        );
        let mut extra = full.clone();
        extra.push("ADMIN");
        assert_eq!(
            scope_of(&head(
                vec![cap("perspective", &[SPACE_A], &extra)],
                Some(SPACE_A)
            )),
            None
        );
        assert_eq!(
            scope_of(&head(
                vec![cap("perspective", &[SPACE_A, SPACE_B], &full)],
                Some(SPACE_A)
            )),
            None
        );
        assert_eq!(
            scope_of(&head(
                vec![cap("perspective", &[SPACE_A], &[])],
                Some(SPACE_A)
            )),
            None
        );
        assert_eq!(
            scope_of(&head(vec![cap("perspective", &[SPACE_A], &["READ"])], None)).as_deref(),
            Some(SPACE_A)
        );
    }

    #[test]
    fn continue_session_sends_on_the_same_id() {
        let (mut model, mem) = model_with(Some((
            "web-1",
            "From the web",
            "hello from web",
            "hello from the web app",
        )));
        assert_eq!(model.view.summaries.len(), 1);
        assert_eq!(model.view.summaries[0].id, "web-1");
        model.open("web-1");
        assert_eq!(model.view.messages[0].text, "hello from web");
        assert_eq!(model.view.messages[1].text, "hello from the web app");
        model.set_draft("and from rust".to_string());
        model.send();
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(
            guard.sends,
            vec![("web-1".to_string(), "and from rust".to_string())]
        );
        assert_eq!(guard.session_count(), 1);
        assert_eq!(guard.creates, 0);
        drop(guard);
        assert_eq!(
            model.view.active.as_ref().map(|active| active.id.as_str()),
            Some("web-1")
        );
        assert!(reply_running(&model.view.messages));
        model.set_draft("nope".to_string());
        model.send();
        assert_eq!(
            mem.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .sends
                .len(),
            1
        );
    }

    #[test]
    fn empty_or_failed_send() {
        let (mut model, mem) =
            model_with(Some(("web-1", "From the web", "hello from web", "done")));
        model.set_draft("   ".to_string());
        model.send();
        assert!(mem
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .sends
            .is_empty());
        assert_eq!(model.view.draft, "   ");

        model.open("web-1");
        model.set_draft("  hi  ".to_string());
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .fail_next();
        model.send();
        assert_eq!(model.view.draft, "hi");
        assert_eq!(model.view.send_failed.as_deref(), Some("send failed"));
        assert!(mem
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .sends
            .is_empty());

        model.back();

        let mut starred = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space("*", None, ChatAccess::Write),
        );
        starred.set_draft("hello".to_string());
        starred.send();
        assert_eq!(
            mem.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .creates,
            0
        );
        assert_eq!(
            starred.view.send_failed.as_deref(),
            Some("a space chat needs a perspective uuid; \"*\" is not one")
        );
        assert!(starred.view.active.is_none());
        assert_eq!(starred.view.draft, "hello");

        let mut model = ChatModel::new(Box::new(mem.clone()));
        let long = "y".repeat(70);
        model.set_draft(long.clone());
        model.send();
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.creates, 1);
        assert_eq!(guard.sends, vec![("sess-1".to_string(), long)]);
        assert_eq!(guard.session_count(), 2);
        drop(guard);
        assert_eq!(
            model.view.active.as_ref().map(|active| active.id.as_str()),
            Some("sess-1")
        );
        assert_eq!(
            model
                .view
                .active
                .as_ref()
                .map(|active| active.title.chars().count()),
            Some(60)
        );
        assert!(reply_running(&model.view.messages));

        model.cancel();
        assert!(!reply_running(&model.view.messages));
        model.set_draft("keep".to_string());
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .fail_next();
        model.resend("other");
        assert_eq!(model.view.draft, "keep");
        assert_eq!(model.view.send_failed.as_deref(), Some("send failed"));
        assert_eq!(
            mem.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .sends
                .len(),
            1
        );
    }

    #[test]
    fn refusal_of_the_last_settled_reply() {
        let user = ChatTurn {
            id: "u".to_string(),
            role: TurnRole::User,
            text: "q".to_string(),
            created_at_ms: 1,
            status: None,
            error: None,
            refused: false,
            steps: Vec::new(),
        };
        let mut settled = ChatTurn {
            id: "a".to_string(),
            role: TurnRole::Assistant,
            text: "no".to_string(),
            created_at_ms: 2,
            status: Some(ReplyStatus::Done),
            error: Some(CAPABILITY_REFUSAL.to_string()),
            refused: true,
            steps: Vec::new(),
        };
        assert_eq!(
            refusal_of(&[user.clone(), settled.clone()], Some(SPACE_A)).as_deref(),
            Some(CAPABILITY_REFUSAL)
        );

        settled.refused = false;
        settled.error = Some("model exploded".to_string());
        settled.steps = vec![ChatStep {
            name: "describe_perspective".to_string(),
            target: Some(SPACE_B.to_string()),
            writes: false,
            outcome: Outcome::Error,
            refused: true,
            error: Some("Capability is not matched".to_string()),
            summary: None,
        }];
        assert_eq!(
            refusal_of(&[user.clone(), settled.clone()], Some(SPACE_A)).as_deref(),
            Some("Capability is not matched")
        );
        settled.steps[0].target = Some(SPACE_A.to_string());
        settled.steps[0].error = Some(format!("Capability is not matched {SPACE_B}"));
        assert_eq!(
            refusal_of(&[user.clone(), settled.clone()], Some(SPACE_A)),
            None
        );
        let foreign = format!("Capability is not matched {SPACE_B}");
        assert_eq!(
            refusal_of(&[user.clone(), settled.clone()], None).as_deref(),
            Some(foreign.as_str())
        );

        let running = ChatTurn {
            id: "run".to_string(),
            role: TurnRole::Assistant,
            text: String::new(),
            created_at_ms: 3,
            status: Some(ReplyStatus::Running),
            error: Some(CAPABILITY_REFUSAL.to_string()),
            refused: true,
            steps: Vec::new(),
        };
        settled.steps.clear();
        settled.error = None;
        settled.refused = false;
        assert_eq!(
            refusal_of(&[user.clone(), settled.clone(), running], Some(SPACE_A)),
            None
        );
        assert_eq!(
            refusal_sentence(Some("  Garden "), true),
            "This chat can only use Garden. It was refused access to another space."
        );
        assert_eq!(
            refusal_sentence(Some("   "), false),
            "The chat was refused access — it reached for something this account may not use."
        );
        assert_eq!(
            unfinished_words(ReplyStatus::Failed),
            Some("The reply failed")
        );
        assert_eq!(unfinished_words(ReplyStatus::Cancelled), Some("Stopped"));
        assert_eq!(
            unfinished_words(ReplyStatus::Interrupted),
            Some("Stopped when the node restarted")
        );
        assert_eq!(unfinished_words(ReplyStatus::Done), None);
        assert_eq!(last_ask(&[user.clone(), settled.clone()]), "q");
        assert_eq!(ask_before(&[user, settled], "a"), "q");
    }

    #[test]
    fn delete_drops_the_session() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        {
            let mut guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            guard.seed("older", "Older", 10, "a", "b");
            guard.seed("newer", "Newer", 20, "c", "d");
        }
        let mut model = ChatModel::new(Box::new(mem.clone()));
        assert_eq!(model.view.summaries[0].id, "newer");
        assert_eq!(model.view.summaries[1].id, "older");
        model.delete("newer");
        assert_eq!(model.view.summaries.len(), 1);
        assert_eq!(model.view.summaries[0].id, "older");
        model.open("older");
        assert!(model.view.active.is_some());
        model.delete("older");
        assert!(model.view.active.is_none());
        assert!(model.view.messages.is_empty());
        assert_eq!(
            mem.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .session_count(),
            0
        );
    }

    #[test]
    fn a_page_is_the_rows_older_than_a_seq() {
        let mut chat = MemoryChat::new();
        let id = chat.create("t", None).unwrap();
        chat.send(&id, "one").unwrap();
        chat.send(&id, "two").unwrap();
        let rows = chat.messages(&id).unwrap();
        let two_seq = rows
            .iter()
            .find(|row| row.content.text.as_deref() == Some("two"))
            .unwrap()
            .seq;
        let page = chat.messages_before(&id, two_seq, 10).unwrap();
        assert!(page
            .iter()
            .any(|row| row.content.text.as_deref() == Some("one")));
        assert!(page.iter().all(|row| row.seq < two_seq));
        let newest_only = chat.messages_before(&id, two_seq, 1).unwrap();
        assert_eq!(newest_only.len(), 1);
        assert!(newest_only[0].seq < two_seq);
        assert_ne!(newest_only[0].content.text.as_deref(), Some("one"));
    }

    /// `poll` seeds one session the first time, the way a create event arrives
    /// after the list was already read.
    struct Announce {
        inner: MemoryChat,
        announced: bool,
    }

    impl ChatPort for Announce {
        fn poll(&mut self) -> bool {
            if self.announced {
                return false;
            }
            self.announced = true;
            self.inner
                .seed("web-1", "From the web", 1, "hello", "reply");
            true
        }
        fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
            self.inner.list()
        }
        fn messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
            self.inner.messages(id)
        }
        fn messages_before(
            &mut self,
            id: &str,
            before: i64,
            limit: u32,
        ) -> Result<Vec<TranscriptRow>, ChatError> {
            self.inner.messages_before(id, before, limit)
        }
        fn create(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError> {
            self.inner.create(title, scope)
        }
        fn send(&mut self, id: &str, text: &str) -> Result<String, ChatError> {
            self.inner.send(id, text)
        }
        fn cancel(&mut self, id: &str) -> Result<bool, ChatError> {
            self.inner.cancel(id)
        }
        fn delete(&mut self, id: &str) -> Result<(), ChatError> {
            self.inner.delete(id)
        }
    }

    #[test]
    fn a_create_shows_up_when_the_port_polls() {
        let mut model = ChatModel::new(Box::new(Announce {
            inner: MemoryChat::new(),
            announced: false,
        }));
        assert!(model.view.summaries.is_empty());
        assert!(model.follow());
        assert_eq!(model.view.summaries.len(), 1);
        assert_eq!(model.view.summaries[0].id, "web-1");
        assert_eq!(model.view.summaries[0].title, "From the web");
        assert!(!model.follow());
    }

    #[test]
    fn a_send_uses_the_host_space() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        let mut model = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_A, Some("Garden".to_string()), ChatAccess::Write),
        );
        model.set_draft("hello".to_string());
        model.send();
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.created, vec![Some(SPACE_A.to_string())]);
        assert_eq!(guard.creates, 1);
        assert_eq!(guard.sends.len(), 1);
        drop(guard);
        assert_eq!(
            model
                .view
                .active
                .as_ref()
                .and_then(|active| active.scope.as_deref()),
            Some(SPACE_A)
        );
    }

    #[test]
    fn the_list_is_the_open_space_only() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        {
            let mut guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            guard.seed("global", "Global", 1, "g", "g");
            guard.create_session("in-a", Some(SPACE_A)).unwrap();
            guard.create_session("in-b", Some(SPACE_B)).unwrap();
        }
        let model = ChatModel::bound(
            Box::new(mem),
            ChatAuthority::space(SPACE_A, None, ChatAccess::Write),
        );
        assert_eq!(model.view.summaries.len(), 1);
        assert_eq!(model.view.summaries[0].scope.as_deref(), Some(SPACE_A));
    }

    #[test]
    fn a_read_only_window_does_not_send() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .seed("a", "A", 1, "hello", "there");
        let mut model = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::global(ChatAccess::ReadOnly),
        );
        assert_eq!(model.view.summaries.len(), 1);
        model.open("a");
        model.set_draft("nope".to_string());
        model.send();
        model.resend("hello");
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert!(guard.sends.is_empty());
        assert_eq!(guard.creates, 0);
        drop(guard);
        assert_eq!(model.view.draft, "nope");
        assert!(model.view.send_failed.is_some());

        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        let mut model = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_A, Some("Garden".to_string()), ChatAccess::ReadOnly),
        );
        model.set_draft("hello".to_string());
        model.send();
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.creates, 0);
        assert!(guard.sends.is_empty());
        drop(guard);
        assert_eq!(model.view.draft, "hello");
        assert_eq!(model.view.active, None);
    }

    /// The port records every cancel and delete and would perform them.
    /// A read-only window, including a grant for A while B is open, must
    /// not call either. A write window on A may delete A and must not
    /// delete B.
    #[test]
    fn a_read_only_window_does_not_cancel_or_delete() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        let (id_a, id_b) = {
            let mut guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            let id_a = guard.create_session("in-a", Some(SPACE_A)).unwrap();
            let id_b = guard.create_session("in-b", Some(SPACE_B)).unwrap();
            (id_a, id_b)
        };
        let mut readonly = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_A, Some("Garden".to_string()), ChatAccess::ReadOnly),
        );
        readonly.open(&id_a);
        readonly.cancel();
        readonly.delete(&id_a);
        // `Access::in_space` for a grant on A while B is open is this model.
        let mut other_space = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_B, None, ChatAccess::ReadOnly),
        );
        other_space.open(&id_b);
        other_space.cancel();
        other_space.delete(&id_b);
        let mut global = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::global(ChatAccess::ReadOnly),
        );
        global.delete(&id_a);
        global.cancel();
        {
            let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            assert_eq!(guard.cancels, 0);
            assert_eq!(guard.deletes, 0);
            assert_eq!(guard.session_count(), 2);
        }
        let mut writer = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_A, None, ChatAccess::Write),
        );
        writer.delete(&id_b);
        writer.view.active = Some(ActiveChat {
            id: id_b.clone(),
            title: "in-b".to_string(),
            scope: Some(SPACE_B.to_string()),
        });
        writer.cancel();
        {
            let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            assert_eq!(guard.cancels, 0);
            assert_eq!(guard.deletes, 0);
            assert_eq!(guard.session_count(), 2);
        }
        writer.delete(&id_a);
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.deletes, 1);
        assert_eq!(guard.cancels, 0);
        assert!(guard.sessions.iter().all(|session| session.id != id_a));
    }

    /// A second client can change the session before this window sees the
    /// event. Send, cancel, and delete read the list again. A failed list
    /// is a refusal. The cached scope is not a permit.
    #[test]
    fn a_send_does_not_trust_the_cached_scope() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        let id = {
            let mut guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            guard.create_session("in-a", Some(SPACE_A)).unwrap()
        };
        let mut model = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_A, None, ChatAccess::Write),
        );
        model.open(&id);
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .retarget(&id, Some(SPACE_B));
        model.set_draft("no".to_string());
        model.send();
        model.cancel();
        model.delete(&id);
        {
            let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            assert!(guard.sends.is_empty(), "{:?}", guard.sends);
            assert_eq!(guard.cancels, 0);
            assert_eq!(guard.deletes, 0);
        }
        assert_eq!(model.view.draft, "no");
        if let Some(active) = model.view.active.as_mut() {
            active.scope = Some(SPACE_A.to_string());
        }
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .retarget(&id, Some(SPACE_A));
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .fail_next_list();
        model.set_draft("still".to_string());
        model.send();
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert!(guard.sends.is_empty(), "{:?}", guard.sends);
        drop(guard);
        assert_eq!(model.view.draft, "still");
    }

    #[test]
    fn a_space_cap_asks_only_for_the_held_verbs() {
        let cap = space_cap(SPACE_A);
        assert_eq!(cap.domain, "perspective");
        assert_eq!(cap.pointers, vec![SPACE_A.to_string()]);
        assert_eq!(cap.can, vec!["READ".to_string(), "UPDATE".to_string()]);
    }

    #[test]
    fn a_foreign_session_is_not_sent() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .seed("b", "B", 1, "x", "y");
        let mut model = ChatModel::bound(
            Box::new(mem.clone()),
            ChatAuthority::space(SPACE_A, None, ChatAccess::Write),
        );
        model.view.active = Some(ActiveChat {
            id: "b".to_string(),
            title: "B".to_string(),
            scope: Some(SPACE_B.to_string()),
        });
        model.set_draft("no".to_string());
        model.send();
        assert!(mem
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .sends
            .is_empty());
        assert_eq!(model.view.send_failed.as_deref(), Some(FOREIGN_CHAT));
        assert_eq!(model.view.draft, "no");
    }

    #[test]
    fn a_failed_open_clears_the_previous_transcript() {
        let mem = Arc::new(Mutex::new(MemoryChat::new()));
        {
            let mut guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
            guard.seed("a", "A", 1, "from-a", "reply-a");
            guard.seed("b", "B", 2, "from-b", "reply-b");
        }
        let mut model = ChatModel::new(Box::new(mem.clone()));
        model.open("a");
        assert!(model.view.messages.iter().any(|turn| turn.text == "from-a"));
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .fail_next_read();
        model.open("b");
        assert_eq!(
            model.view.active.as_ref().map(|active| active.id.as_str()),
            Some("b")
        );
        assert!(model.view.messages.is_empty(), "{:?}", model.view.messages);
        assert_eq!(model.view.error.as_deref(), Some("read failed"));
    }

    #[test]
    fn a_failed_reload_keeps_the_open_transcript() {
        let (mut model, mem) =
            model_with(Some(("web-1", "From the web", "hello from web", "done")));
        model.open("web-1");
        let before = model.view.messages.clone();
        assert!(!before.is_empty());
        mem.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .fail_next_read();
        model.cancel();
        assert_eq!(model.view.messages, before);
        assert_eq!(model.view.error.as_deref(), Some("read failed"));
        assert_eq!(
            model.view.active.as_ref().map(|active| active.id.as_str()),
            Some("web-1")
        );
    }

    /// `poll` deletes the open session, the way a remote delete arrives.
    struct DropActive {
        inner: MemoryChat,
        dropped: bool,
    }

    impl ChatPort for DropActive {
        fn poll(&mut self) -> bool {
            if self.dropped {
                return false;
            }
            self.dropped = true;
            self.inner.delete_session("a").unwrap();
            true
        }
        fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
            self.inner.list()
        }
        fn messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
            self.inner.messages(id)
        }
        fn messages_before(
            &mut self,
            id: &str,
            before: i64,
            limit: u32,
        ) -> Result<Vec<TranscriptRow>, ChatError> {
            self.inner.messages_before(id, before, limit)
        }
        fn create(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError> {
            self.inner.create(title, scope)
        }
        fn send(&mut self, id: &str, text: &str) -> Result<String, ChatError> {
            self.inner.send(id, text)
        }
        fn cancel(&mut self, id: &str) -> Result<bool, ChatError> {
            self.inner.cancel(id)
        }
        fn delete(&mut self, id: &str) -> Result<(), ChatError> {
            self.inner.delete(id)
        }
    }

    #[test]
    fn a_deleted_session_clears_the_transcript() {
        let mut inner = MemoryChat::new();
        inner.seed("a", "A", 1, "from-a", "reply-a");
        let mut model = ChatModel::new(Box::new(DropActive {
            inner,
            dropped: false,
        }));
        model.open("a");
        assert!(model.view.messages.iter().any(|turn| turn.text == "from-a"));
        assert!(model.follow());
        assert!(model.view.active.is_none());
        assert!(model.view.messages.is_empty());
        assert!(model.view.summaries.is_empty());
    }

    /// `messages` returns only the newest [`MESSAGE_PAGE`] rows.
    struct Paged {
        rows: Vec<TranscriptRow>,
    }

    impl Paged {
        fn rows(rows: Vec<TranscriptRow>) -> Self {
            Self { rows }
        }

        fn page(&self, before: Option<i64>, limit: u32) -> Vec<TranscriptRow> {
            let mut rows: Vec<TranscriptRow> = self
                .rows
                .iter()
                .filter(|row| before.is_none_or(|seq| row.seq < seq))
                .cloned()
                .collect();
            rows.sort_by_key(|row| row.seq);
            let keep = limit as usize;
            if rows.len() > keep {
                rows = rows.split_off(rows.len() - keep);
            }
            rows
        }
    }

    impl ChatPort for Paged {
        fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
            Ok(vec![ChatSummary {
                id: "s".to_string(),
                title: "Long".to_string(),
                scope: None,
                created_at_ms: 1,
                updated_at_ms: 1,
            }])
        }
        fn messages(&mut self, _id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
            Ok(self.page(None, MESSAGE_PAGE))
        }
        fn messages_before(
            &mut self,
            _id: &str,
            before: i64,
            limit: u32,
        ) -> Result<Vec<TranscriptRow>, ChatError> {
            Ok(self.page(Some(before), limit))
        }
        fn create(&mut self, _title: &str, _scope: Option<&str>) -> Result<String, ChatError> {
            Err(ChatError::Failed("no create".to_string()))
        }
        fn send(&mut self, _id: &str, _text: &str) -> Result<String, ChatError> {
            Err(ChatError::Failed("no send".to_string()))
        }
        fn cancel(&mut self, _id: &str) -> Result<bool, ChatError> {
            Ok(false)
        }
        fn delete(&mut self, _id: &str) -> Result<(), ChatError> {
            Ok(())
        }
    }

    #[test]
    fn the_full_transcript_includes_the_row_before_the_newest_page() {
        let mut rows = Vec::new();
        for seq in 1..=201 {
            let text = if seq == 1 {
                "zero".to_string()
            } else {
                format!("row-{seq}")
            };
            rows.push(text_row(
                &format!("r{seq}"),
                seq,
                TranscriptRole::User,
                &text,
            ));
        }
        let mut model = ChatModel::new(Box::new(Paged::rows(rows)));
        model.open("s");
        assert!(
            model.view.messages.iter().any(|turn| turn.text == "zero"),
            "newest page hid the oldest row: {} turns",
            model.view.messages.len()
        );
        assert_eq!(model.view.messages.len(), 201);
    }

    #[test]
    fn a_tool_page_keeps_the_assistant_that_started_it() {
        let mut rows = vec![
            text_row("u", 1, TranscriptRole::User, "ask"),
            assistant("a", 2, "parent", "done", None),
        ];
        for seq in 3..=202 {
            rows.push(tool(
                &format!("t{seq}"),
                seq,
                named("instance_create"),
                "done",
                None,
            ));
        }
        let mut model = ChatModel::new(Box::new(Paged::rows(rows)));
        model.open("s");
        assert!(model.view.messages.iter().any(|turn| turn.text == "ask"));
        let parent = model
            .view
            .messages
            .iter()
            .find(|turn| turn.text == "parent")
            .expect("parent assistant");
        assert_eq!(parent.steps.len(), 200);
        assert!(parent
            .steps
            .iter()
            .all(|step| step.name == "instance_create"));
    }

    #[test]
    fn a_failed_write_keeps_its_intent() {
        let mut failed = named("space_delete");
        failed.writes = Some(true);
        let turns = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "", "failed", None),
            tool("t", 3, failed, "failed", Some("partial")),
        ]);
        let step = &turns[1].steps[0];
        assert!(step.writes);
        assert_eq!(step.outcome, Outcome::Error);
        assert_eq!(step_label(step), "space_delete · write operation · failed");

        let mut running = named("instance_create");
        running.writes = Some(true);
        let turns = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "", "running", None),
            tool("t", 3, running, "running", None),
        ]);
        assert_eq!(
            step_label(&turns[1].steps[0]),
            "instance_create · write operation · running"
        );

        let mut stopped = named("add_link");
        stopped.writes = Some(true);
        let turns = conversation_of(&[
            text_row("u", 1, TranscriptRole::User, "q"),
            assistant("a", 2, "", "cancelled", None),
            tool("t", 3, stopped, "running", None),
        ]);
        assert_eq!(
            step_label(&turns[1].steps[0]),
            "add_link · write operation · stopped"
        );
        assert!(!step_label(&turns[1].steps[0]).contains("wrote"));
    }
}
