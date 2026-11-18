//! `ai.session*` over [`WsRpcClient::call`](ad4m_client::ws_rpc::WsRpcClient::call).
//!
//! The rust `ad4m-client` pin has no `ai` module. The param and result
//! structs here mirror the generated contracts (`AISession`, `AISessionCreate`,
//! `AISessionSendParams`, and the rest). A typed `ai` module in `ad4m-client`
//! replaces this file in one place. Issue 1743 (CLI chat) needs that API.
//! This branch does not add the module there.
//!
//! [`AiSessionChat`] is the live [`ChatPort`](we_data::chat::ChatPort).
//! [`crate::Connection`]'s runtime runs the calls. Build it on a thread that
//! is not a worker of that runtime: `Handle::block_on` from such a worker
//! deadlocks.

use std::future::Future;
use std::sync::{Arc, Mutex};

use ad4m_client::ws_rpc::WsRpcClient;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tokio::sync::broadcast::error::TryRecvError;
use we_data::chat::{
    bad_scope_message, plain_uuid, scope_of, space_cap, ChatError, ChatPort, ChatSummary,
    RowContent, SessionHead, TranscriptRole, TranscriptRow,
};

use crate::Connection;

/// `WsRpcClient::call` takes a JSON value. This is the only place that builds one.
async fn call<P, R>(ws: &WsRpcClient, method: &str, params: &P) -> anyhow::Result<R>
where
    P: Serialize,
    R: DeserializeOwned,
{
    let params = serde_json::to_value(params)?;
    ws.call(method, params).await
}

/// `ai.sessionList` takes no fields. An empty struct is `{}`, not null.
#[derive(Debug, Serialize)]
struct Empty {}

/// What `events.watch` is given. A unit field is JSON null, which means
/// every perspective.
#[derive(Debug, Serialize)]
struct SessionWatch {
    #[serde(rename = "ai-session-changed")]
    ai_session_changed: (),
}

/// `with` on a capability, as the generated `Resource` names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resource {
    pub domain: String,
    pub pointers: Vec<String>,
}

/// One capability, as the generated `Capability` names it: `{ with, can }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capability {
    pub with: Resource,
    pub can: Vec<String>,
}

/// An `ai_sessions` row. Timestamps are RFC3339 strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSession {
    pub id: String,
    pub owner_did: Option<String>,
    pub title: String,
    pub model: Option<String>,
    pub default_perspective: Option<String>,
    pub library_perspective: Option<String>,
    pub capabilities: Vec<Capability>,
    pub created_at: String,
    pub updated_at: String,
}

/// Who wrote an `ai_messages` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiSessionMessageRole {
    User,
    Assistant,
    Tool,
}

/// Where an assistant turn or a tool step is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTurnStatus {
    Running,
    Done,
    Failed,
    Cancelled,
    Interrupted,
}

impl AiTurnStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }
}

/// One `ai_messages` row. `content` is the generated `unknown`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionMessage {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub role: AiSessionMessageRole,
    /// `{"text"}` for a person or the assistant. A tool step is
    /// `{"name","arguments","target"?,"writes","result"?|"error"?}`.
    pub content: Json,
    pub status: Option<AiTurnStatus>,
    pub error: Option<String>,
    pub created_at: String,
}

/// `ai.sessionCreate`. Absent `capabilities` is JSON null: the executor
/// stores everything the caller holds. An empty list is not the same.
/// [`create_params`] never leaves this field absent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionCreate {
    pub title: Option<String>,
    pub model: Option<String>,
    pub default_perspective: Option<String>,
    pub library_perspective: Option<String>,
    pub capabilities: Option<Vec<Capability>>,
}

/// `ai.session` and `ai.sessionDelete`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiIdParams {
    pub id: String,
}

/// `ai.sessionSend`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionSendParams {
    pub session_id: String,
    pub text: String,
}

/// `ai.sessionSend`'s answer. The turn keeps running after this returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionSendStarted {
    pub message_id: String,
    pub reply_id: String,
}

/// `ai.sessionCancel`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionCancelParams {
    pub session_id: String,
}

/// `ai.sessionMessages`. Null `limit` and `before` are the executor's defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionMessagesParams {
    pub session_id: String,
    pub limit: Option<u32>,
    pub before: Option<i64>,
}

/// `ai.sessionUpdate`. A field left `None` is omitted, so the column stays.
/// `Some(None)` is JSON null and clears a nullable column.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionUpdateRequest {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_perspective: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_perspective: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<Capability>>,
}

/// The `ai-session-changed` payload. On the wire these fields sit beside `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionChanged {
    pub session_id: String,
    /// `created`, `updated`, `deleted`, or `message`.
    pub kind: String,
    pub session: Option<AiSession>,
    pub message: Option<AiSessionMessage>,
}

#[derive(Debug, Deserialize)]
struct EventFrame {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(flatten)]
    change: AiSessionChanged,
}

fn read_change(value: Json) -> Option<AiSessionChanged> {
    let frame: EventFrame = serde_json::from_value(value).ok()?;
    (frame.event_type == "ai-session-changed").then_some(frame.change)
}

/// The receiver `watch_changes` subscribed. Other event types are skipped.
pub struct SessionEvents {
    rx: tokio::sync::broadcast::Receiver<Json>,
}

impl SessionEvents {
    /// The next `ai-session-changed` payload, if one is waiting.
    pub fn try_next(&mut self) -> Option<AiSessionChanged> {
        loop {
            match self.rx.try_recv() {
                Ok(value) => {
                    if let Some(change) = read_change(value) {
                        return Some(change);
                    }
                }
                Err(TryRecvError::Empty | TryRecvError::Closed) => return None,
                Err(TryRecvError::Lagged(_)) => {}
            }
        }
    }

    /// Drain the queue. True when a session event arrived, or the receiver
    /// lagged and the caller should read the session again.
    pub fn changed(&mut self) -> bool {
        let mut any = false;
        loop {
            match self.rx.try_recv() {
                Ok(value) => {
                    if read_change(value).is_some() {
                        any = true;
                    }
                }
                Err(TryRecvError::Empty | TryRecvError::Closed) => return any,
                Err(TryRecvError::Lagged(_)) => any = true,
            }
        }
    }
}

/// `ai.sessionCreate`.
pub async fn session_create(
    ws: &WsRpcClient,
    params: &AiSessionCreate,
) -> anyhow::Result<AiSession> {
    call(ws, "ai.sessionCreate", params).await
}

/// `ai.sessionList`.
pub async fn session_list(ws: &WsRpcClient) -> anyhow::Result<Vec<AiSession>> {
    call(ws, "ai.sessionList", &Empty {}).await
}

/// `ai.session`.
pub async fn session(ws: &WsRpcClient, params: &AiIdParams) -> anyhow::Result<AiSession> {
    call(ws, "ai.session", params).await
}

/// `ai.sessionUpdate`.
pub async fn session_update(
    ws: &WsRpcClient,
    params: &AiSessionUpdateRequest,
) -> anyhow::Result<AiSession> {
    call(ws, "ai.sessionUpdate", params).await
}

/// `ai.sessionDelete`.
pub async fn session_delete(ws: &WsRpcClient, params: &AiIdParams) -> anyhow::Result<bool> {
    call(ws, "ai.sessionDelete", params).await
}

/// `ai.sessionSend`. Returns when the rows are stored. The model runs after.
pub async fn session_send(
    ws: &WsRpcClient,
    params: &AiSessionSendParams,
) -> anyhow::Result<AiSessionSendStarted> {
    call(ws, "ai.sessionSend", params).await
}

/// `ai.sessionCancel`.
pub async fn session_cancel(
    ws: &WsRpcClient,
    params: &AiSessionCancelParams,
) -> anyhow::Result<bool> {
    call(ws, "ai.sessionCancel", params).await
}

/// `ai.sessionMessages`.
pub async fn session_messages(
    ws: &WsRpcClient,
    params: &AiSessionMessagesParams,
) -> anyhow::Result<Vec<AiSessionMessage>> {
    call(ws, "ai.sessionMessages", params).await
}

/// Subscribe to `ai-session-changed`, the same `watch_events` path the
/// other user interests use. Replaces the unnamed user interest. Named
/// interests, such as a live query, stay.
pub async fn watch_changes(ws: &WsRpcClient) -> anyhow::Result<SessionEvents> {
    let spec = serde_json::to_value(&SessionWatch {
        ai_session_changed: (),
    })?;
    let rx = ws.watch_events(spec).await?;
    Ok(SessionEvents { rx })
}

/// The live [`ChatPort`](we_data::chat::ChatPort). [`MemoryChat`](we_data::chat::MemoryChat)
/// stays the fake the headless tests drive.
pub struct AiSessionChat {
    handle: tokio::runtime::Handle,
    ws: Arc<WsRpcClient>,
    events: Mutex<Option<SessionEvents>>,
}

impl AiSessionChat {
    /// Subscribe once. A failed subscribe leaves follow quiet. List and send
    /// still run.
    pub fn new(conn: &Connection) -> Self {
        let events = match conn.handle().block_on(watch_changes(conn.ws())) {
            Ok(events) => Some(events),
            Err(err) => {
                log::warn!("ai-session-changed subscribe failed: {err:#}");
                None
            }
        };
        Self {
            handle: conn.handle().clone(),
            ws: Arc::clone(conn.ws()),
            events: Mutex::new(events),
        }
    }

    fn wait<T>(&self, fut: impl Future<Output = anyhow::Result<T>>) -> Result<T, ChatError> {
        self.handle
            .block_on(fut)
            .map_err(|err| ChatError::Failed(err.to_string()))
    }

    fn load_messages(
        &self,
        id: &str,
        limit: Option<u32>,
        before: Option<i64>,
    ) -> Result<Vec<TranscriptRow>, ChatError> {
        let ws = Arc::clone(&self.ws);
        let params = AiSessionMessagesParams {
            session_id: id.to_string(),
            limit,
            before,
        };
        let messages = self.wait(async move { session_messages(&ws, &params).await })?;
        Ok(messages.iter().map(row_of).collect())
    }
}

impl ChatPort for AiSessionChat {
    fn list(&mut self) -> Result<Vec<ChatSummary>, ChatError> {
        let ws = Arc::clone(&self.ws);
        let mut rows = self.wait(async move {
            let sessions = session_list(&ws).await?;
            Ok(sessions.iter().map(summary_of).collect::<Vec<_>>())
        })?;
        newest_first(&mut rows);
        Ok(rows)
    }

    fn messages(&mut self, id: &str) -> Result<Vec<TranscriptRow>, ChatError> {
        self.load_messages(id, Some(we_data::chat::MESSAGE_PAGE), None)
    }

    fn messages_before(
        &mut self,
        id: &str,
        before: i64,
        limit: u32,
    ) -> Result<Vec<TranscriptRow>, ChatError> {
        self.load_messages(id, Some(limit), Some(before))
    }

    fn create(&mut self, title: &str, scope: Option<&str>) -> Result<String, ChatError> {
        let params = create_params(title, scope)?;
        let ws = Arc::clone(&self.ws);
        let session = self.wait(async move { session_create(&ws, &params).await })?;
        Ok(session.id)
    }

    fn send(&mut self, id: &str, text: &str) -> Result<String, ChatError> {
        let ws = Arc::clone(&self.ws);
        let params = AiSessionSendParams {
            session_id: id.to_string(),
            text: text.to_string(),
        };
        let started = self.wait(async move { session_send(&ws, &params).await })?;
        Ok(started.reply_id)
    }

    fn cancel(&mut self, id: &str) -> Result<bool, ChatError> {
        let ws = Arc::clone(&self.ws);
        let params = AiSessionCancelParams {
            session_id: id.to_string(),
        };
        self.wait(async move { session_cancel(&ws, &params).await })
    }

    fn delete(&mut self, id: &str) -> Result<(), ChatError> {
        let ws = Arc::clone(&self.ws);
        let params = AiIdParams { id: id.to_string() };
        let label = params.id.clone();
        let removed = self.wait(async move { session_delete(&ws, &params).await })?;
        if removed {
            Ok(())
        } else {
            Err(ChatError::Failed(format!("no chat {label}")))
        }
    }

    fn poll(&mut self) -> bool {
        self.events
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_mut()
            .is_some_and(SessionEvents::changed)
    }
}

fn newest_first(rows: &mut [ChatSummary]) {
    rows.sort_by(|left, right| {
        right
            .updated_at_ms
            .cmp(&left.updated_at_ms)
            .then(right.created_at_ms.cmp(&left.created_at_ms))
            .then(right.id.cmp(&left.id))
    });
}

fn summary_of(session: &AiSession) -> ChatSummary {
    let capabilities = session
        .capabilities
        .iter()
        .map(|cap| we_data::chat::ChatCap {
            domain: cap.with.domain.clone(),
            pointers: cap.with.pointers.clone(),
            can: cap.can.clone(),
        })
        .collect();
    ChatSummary {
        id: session.id.clone(),
        title: session.title.clone(),
        scope: scope_of(&SessionHead {
            capabilities,
            default_perspective: session.default_perspective.clone(),
        }),
        created_at_ms: rfc3339_ms(&session.created_at),
        updated_at_ms: rfc3339_ms(&session.updated_at),
    }
}

fn create_params(title: &str, scope: Option<&str>) -> Result<AiSessionCreate, ChatError> {
    let (default_perspective, capabilities) = match scope {
        Some(uuid) if !plain_uuid(uuid) => {
            return Err(ChatError::Failed(bad_scope_message(uuid)));
        }
        Some(uuid) => {
            let cap = space_cap(uuid);
            (
                Some(uuid.to_string()),
                Some(vec![Capability {
                    with: Resource {
                        domain: cap.domain,
                        pointers: cap.pointers,
                    },
                    can: cap.can,
                }]),
            )
        }
        // An omitted scope is a host-authorized global chat. An empty list
        // is not JSON null, so the executor does not store every capability
        // the caller holds.
        None => (None, Some(Vec::new())),
    };
    Ok(AiSessionCreate {
        title: Some(title.to_string()),
        model: None,
        default_perspective,
        library_perspective: None,
        capabilities,
    })
}

fn row_of(message: &AiSessionMessage) -> TranscriptRow {
    TranscriptRow {
        id: message.id.clone(),
        seq: message.seq,
        role: match message.role {
            AiSessionMessageRole::User => TranscriptRole::User,
            AiSessionMessageRole::Assistant => TranscriptRole::Assistant,
            AiSessionMessageRole::Tool => TranscriptRole::Tool,
        },
        content: row_content(&message.content),
        status: message.status.map(|status| status.as_str().to_string()),
        error: message.error.clone(),
        created_at_ms: rfc3339_ms(&message.created_at),
    }
}

fn row_content(value: &Json) -> RowContent {
    let result = match value.get("result") {
        Some(Json::String(text)) => Some(text.clone()),
        Some(other) if !other.is_null() => Some(other.to_string()),
        _ => None,
    };
    RowContent {
        text: json_str(value, "text"),
        name: json_str(value, "name"),
        perspective_id: json_str(value, "perspectiveId")
            .or_else(|| json_str(value, "perspective_id"))
            .or_else(|| argument_str(value, "perspectiveId"))
            .or_else(|| argument_str(value, "perspective_id")),
        target: json_str(value, "target"),
        result,
        error: json_str(value, "error"),
        writes: value.get("writes").and_then(Json::as_bool),
    }
}

fn argument_str(value: &Json, key: &str) -> Option<String> {
    value.get("arguments").and_then(|args| json_str(args, key))
}

fn json_str(value: &Json, key: &str) -> Option<String> {
    value.get(key).and_then(Json::as_str).map(str::to_string)
}

/// Milliseconds since the Unix epoch. A string that is not RFC3339 is 0.
/// The panel does not show the number.
fn rfc3339_ms(text: &str) -> i64 {
    let bytes = text.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return 0;
    }
    let Some(year) = text[0..4].parse::<i64>().ok() else {
        return 0;
    };
    let Some(month) = text[5..7].parse::<i64>().ok() else {
        return 0;
    };
    let Some(day) = text[8..10].parse::<i64>().ok() else {
        return 0;
    };
    let Some(hour) = text[11..13].parse::<i64>().ok() else {
        return 0;
    };
    let Some(minute) = text[14..16].parse::<i64>().ok() else {
        return 0;
    };
    let Some(second) = text[17..19].parse::<i64>().ok() else {
        return 0;
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return 0;
    }
    let mut index = 19;
    let mut fraction_ms = 0_i64;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index == start {
            return 0;
        }
        let mut millis = String::new();
        for digit in text[start..index].chars().take(3) {
            millis.push(digit);
        }
        while millis.len() < 3 {
            millis.push('0');
        }
        fraction_ms = millis.parse().unwrap_or(0);
    }
    let Some(offset_min) = offset_minutes(&text[index..]) else {
        return 0;
    };
    let unix = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second
        - offset_min * 60;
    unix.saturating_mul(1_000).saturating_add(fraction_ms)
}

fn offset_minutes(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let sign = *bytes.first()?;
    if sign == b'Z' || sign == b'z' {
        return Some(0);
    }
    let negative = match sign {
        b'+' => false,
        b'-' => true,
        _ => return None,
    };
    let rest = 1;
    let (hour, minute) = if bytes.get(rest + 2) == Some(&b':') && rest + 5 <= bytes.len() {
        (
            text[rest..rest + 2].parse::<i64>().ok()?,
            text[rest + 3..rest + 5].parse::<i64>().ok()?,
        )
    } else if rest + 4 <= bytes.len() {
        (
            text[rest..rest + 2].parse::<i64>().ok()?,
            text[rest + 2..rest + 4].parse::<i64>().ok()?,
        )
    } else {
        return None;
    };
    if hour > 23 || minute > 59 {
        return None;
    }
    let minutes = hour * 60 + minute;
    Some(if negative { -minutes } else { minutes })
}

/// Days since 1970-01-01. Howard Hinnant's `days_from_civil`.
fn days_from_civil(mut year: i64, month: i64, day: i64) -> i64 {
    year -= if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_params_match_the_generated_names() {
        let params = AiSessionCreate {
            title: Some("From the web".to_string()),
            model: None,
            default_perspective: None,
            library_perspective: None,
            capabilities: None,
        };
        let value = serde_json::to_value(&params).unwrap();
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("defaultPerspective"));
        assert!(obj.contains_key("libraryPerspective"));
        assert!(obj.get("capabilities").unwrap().is_null());
        assert!(obj.get("default_perspective").is_none());
        assert_eq!(
            serde_json::to_value(&Empty {})
                .unwrap()
                .as_object()
                .map(serde_json::Map::len),
            Some(0)
        );

        let send = serde_json::to_value(&AiSessionSendParams {
            session_id: "s1".to_string(),
            text: "hello".to_string(),
        })
        .unwrap();
        assert_eq!(send.get("sessionId").and_then(Json::as_str), Some("s1"));
        assert!(send.get("session_id").is_none());

        let page = serde_json::to_value(&AiSessionMessagesParams {
            session_id: "s1".to_string(),
            limit: None,
            before: Some(4),
        })
        .unwrap();
        assert!(page.get("limit").unwrap().is_null());
        assert_eq!(page.get("before").and_then(Json::as_i64), Some(4));
        assert!(page.get("sessionId").is_some());

        let update = serde_json::to_value(&AiSessionUpdateRequest {
            id: "s1".to_string(),
            title: None,
            model: Some(None),
            default_perspective: None,
            library_perspective: Some(Some("lib".to_string())),
            capabilities: None,
        })
        .unwrap();
        assert!(update.get("title").is_none());
        assert!(update.get("model").unwrap().is_null());
        assert!(update.get("defaultPerspective").is_none());
        assert_eq!(
            update.get("libraryPerspective").and_then(Json::as_str),
            Some("lib")
        );
        assert!(update.get("capabilities").is_none());

        let watch = serde_json::to_value(&SessionWatch {
            ai_session_changed: (),
        })
        .unwrap();
        assert!(watch.get("ai-session-changed").unwrap().is_null());
        assert!(watch.get("ai_session_changed").is_none());
    }

    #[test]
    fn a_create_never_sends_null_capabilities() {
        let global = create_params("t", None).unwrap();
        let value = serde_json::to_value(&global).unwrap();
        assert!(value.get("capabilities").unwrap().is_array(), "{value}");
        assert!(value["capabilities"].as_array().unwrap().is_empty());
        let scoped = create_params("t", Some("a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2")).unwrap();
        let value = serde_json::to_value(&scoped).unwrap();
        assert!(value.get("capabilities").unwrap().is_array(), "{value}");
        let caps = value["capabilities"].as_array().unwrap();
        assert_eq!(caps.len(), 1, "{value}");
        let verbs: Vec<&str> = caps[0]["can"]
            .as_array()
            .unwrap()
            .iter()
            .map(|verb| verb.as_str().unwrap())
            .collect();
        assert_eq!(verbs, ["READ", "UPDATE"]);
        assert!(create_params("t", Some("*")).is_err());
        assert!(create_params("t", Some("")).is_err());
    }

    #[test]
    fn a_tool_row_reads_perspective_id_from_arguments() {
        let raw = r#"{"id":"m","sessionId":"s","seq":3,"role":"tool","content":{"name":"instance_create","arguments":{"perspective_id":"a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2"},"writes":true},"status":"done","error":null,"createdAt":"2026-11-18T10:46:23Z"}"#;
        let message: AiSessionMessage = serde_json::from_str(raw).unwrap();
        let row = row_of(&message);
        assert_eq!(
            row.content.perspective_id.as_deref(),
            Some("a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2")
        );
        assert_eq!(row.content.name.as_deref(), Some("instance_create"));
        assert_eq!(row.content.writes, Some(true));

        let camel = r#"{"id":"m2","sessionId":"s","seq":4,"role":"tool","content":{"name":"x","arguments":{"perspectiveId":"b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2"}},"status":"done","error":null,"createdAt":"2026-11-18T10:46:23Z"}"#;
        let message: AiSessionMessage = serde_json::from_str(camel).unwrap();
        assert_eq!(
            row_of(&message).content.perspective_id.as_deref(),
            Some("b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2")
        );

        let top = r#"{"id":"m3","sessionId":"s","seq":5,"role":"tool","content":{"name":"x","perspectiveId":"a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2","arguments":{"perspective_id":"b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2"}},"status":"done","error":null,"createdAt":"2026-11-18T10:46:23Z"}"#;
        let message: AiSessionMessage = serde_json::from_str(top).unwrap();
        assert_eq!(
            row_of(&message).content.perspective_id.as_deref(),
            Some("a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2")
        );
    }

    #[test]
    fn an_event_frame_keeps_the_generated_fields() {
        let raw = r#"{"type":"ai-session-changed","sessionId":"s1","kind":"created","session":{"id":"s1","ownerDid":null,"title":"From the web","model":null,"defaultPerspective":null,"libraryPerspective":null,"capabilities":[{"with":{"domain":"perspective","pointers":["a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2"]},"can":["READ"]}],"createdAt":"2026-11-18T10:46:23Z","updatedAt":"2026-11-18T10:46:23Z"},"message":null}"#;
        let value: Json = serde_json::from_str(raw).unwrap();
        let change = read_change(value);
        assert_eq!(
            change.as_ref().map(|row| row.kind.as_str()),
            Some("created")
        );
        let change = change.unwrap();
        assert_eq!(change.session_id, "s1");
        let session = change.session.unwrap();
        assert_eq!(session.title, "From the web");
        assert_eq!(session.capabilities[0].with.domain, "perspective");
        assert!(change.message.is_none());
    }

    #[test]
    fn a_timestamp_keeps_its_offset() {
        let utc = rfc3339_ms("2026-11-18T10:46:23Z");
        assert_ne!(utc, 0);
        assert_eq!(rfc3339_ms("2026-11-18T12:46:23+02:00"), utc);
        assert_eq!(rfc3339_ms("2026-11-18T05:46:23-05:00"), utc);
        assert_eq!(rfc3339_ms("2026-11-18T10:46:23.123Z") - utc, 123);
        assert_eq!(rfc3339_ms("1970-01-01T00:00:00Z"), 0);
        assert_eq!(rfc3339_ms("not-a-time"), 0);
    }
}
