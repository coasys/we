//! The IPC bridge between a page and this process: what the page may send, and how answers return.
//!
//! The page posts `{ id, nonce, cmd, args }` through wry's `window.ipc.postMessage`. The nonce is
//! made per window at launch and given only to that window's main frame, inside a closure
//! ([`init_script`]), so a frame that can post to `window.ipc` without having been handed the nonce
//! — an embedded app's iframe — is refused. That stands in for what Tauri gets from capabilities
//! scoped by origin: on Linux wry reports every message as coming from the main frame's URL, so
//! the URL cannot tell the two apart.
//!
//! Answers go back as script: `settle(id, ok, value)` resolves the page's promise, `emit(event,
//! payload)` calls its listeners. Values cross as JSON, so nothing the page sends is ever
//! interpolated into script as code.

use serde::Deserialize;
use serde_json::Value;

/// One call from a page.
#[derive(Debug, Deserialize, PartialEq)]
pub struct Request {
    pub id: u64,
    pub nonce: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    Malformed(String),
    WrongNonce,
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refused::Malformed(why) => write!(f, "malformed IPC message: {why}"),
            Refused::WrongNonce => write!(f, "IPC message without this window's nonce"),
        }
    }
}

/// Parses `body` and checks it carries `nonce`. The comparison runs over the whole string whatever
/// it holds, so its time says nothing about how much of a guess was right.
pub fn parse(body: &str, nonce: &str) -> Result<Request, Refused> {
    let request: Request =
        serde_json::from_str(body).map_err(|e| Refused::Malformed(e.to_string()))?;
    if !constant_time_eq(request.nonce.as_bytes(), nonce.as_bytes()) {
        return Err(Refused::WrongNonce);
    }
    Ok(request)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A fresh nonce for one window.
pub fn nonce() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// A JSON value as a JS expression. JSON is valid JS except for U+2028/U+2029 in strings on old
/// engines; escaping them keeps the script parseable everywhere.
fn js_value(value: &Value) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "null".into())
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// The script that answers call `id`.
pub fn settle_script(id: u64, result: &Result<Value, String>) -> String {
    let (ok, value) = match result {
        Ok(value) => (true, value.clone()),
        Err(message) => (false, Value::String(message.clone())),
    };
    format!("window.__WE_GPUI__ && window.__WE_GPUI__.settle({id}, {ok}, {});", js_value(&value))
}

/// The script that delivers `event` to the page's listeners.
pub fn emit_script(event: &str, payload: &Value) -> String {
    format!(
        "window.__WE_GPUI__ && window.__WE_GPUI__.emit({}, {});",
        js_value(&Value::String(event.into())),
        js_value(payload)
    )
}

/// Installed in the main frame before any page script runs. Defines `window.__WE_GPUI__` — `invoke`
/// and `listen` for the page, `settle` and `emit` for this process — non-writable, so a later
/// script cannot replace it, with the nonce held in the closure.
pub fn init_script(nonce: &str) -> String {
    let nonce = js_value(&Value::String(nonce.into()));
    format!(
        r#"(() => {{
  if (window.__WE_GPUI__) return;
  const nonce = {nonce};
  const post = (m) => window.ipc.postMessage(m);
  let next = 1;
  const pending = new Map();
  const listeners = new Map();
  const api = {{
    invoke(cmd, args) {{
      return new Promise((resolve, reject) => {{
        const id = next++;
        pending.set(id, {{ resolve, reject }});
        post(JSON.stringify({{ id, nonce, cmd, args: args ?? {{}} }}));
      }});
    }},
    listen(event, fn) {{
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return () => set.delete(fn);
    }},
    settle(id, ok, value) {{
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(value) : p.reject(new Error(String(value)));
    }},
    emit(event, payload) {{
      for (const fn of listeners.get(event) ?? []) {{
        try {{ fn({{ event, payload }}); }} catch (e) {{ console.error(e); }}
      }}
    }},
  }};
  Object.defineProperty(window, '__WE_GPUI__', {{ value: Object.freeze(api), writable: false, configurable: false }});
}})();"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_message_with_the_nonce_parses() {
        let body = r#"{"id":3,"nonce":"abc","cmd":"get_port","args":{}}"#;
        let request = parse(body, "abc").unwrap();
        assert_eq!(request.id, 3);
        assert_eq!(request.cmd, "get_port");
    }

    #[test]
    fn args_default_to_null_when_absent() {
        let request = parse(r#"{"id":1,"nonce":"n","cmd":"x"}"#, "n").unwrap();
        assert_eq!(request.args, Value::Null);
    }

    #[test]
    fn a_message_without_the_nonce_is_refused() {
        assert_eq!(
            parse(r#"{"id":1,"nonce":"guess","cmd":"x"}"#, "abc"),
            Err(Refused::WrongNonce)
        );
        assert_eq!(parse(r#"{"id":1,"nonce":"ab","cmd":"x"}"#, "abc"), Err(Refused::WrongNonce));
    }

    #[test]
    fn a_malformed_message_is_refused() {
        assert!(matches!(parse("not json", "n"), Err(Refused::Malformed(_))));
        assert!(matches!(parse(r#"{"id":1,"cmd":"x"}"#, "n"), Err(Refused::Malformed(_))));
    }

    #[test]
    fn answers_carry_values_as_json_never_as_code() {
        let script = settle_script(7, &Ok(json!({"a": "</script>\u{2028}"})));
        assert!(script.contains("settle(7, true, {\"a\":\"</script>\\u2028\"})"));
        let script = settle_script(8, &Err("it's \"bad\"".into()));
        assert!(script.contains(r#"settle(8, false, "it's \"bad\"")"#));
        let script = emit_script("identity-step-done", &json!({"outcome": "done"}));
        assert!(script.contains(r#"emit("identity-step-done", {"outcome":"done"})"#));
    }

    #[test]
    fn the_init_script_holds_the_nonce_as_a_string_literal() {
        let script = init_script("n\"');alert(1)//");
        assert!(script.contains(r#"const nonce = "n\"');alert(1)//";"#));
    }

    #[test]
    fn nonces_differ() {
        assert_ne!(nonce(), nonce());
        assert_eq!(nonce().len(), 32);
    }
}
