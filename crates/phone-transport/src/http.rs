//! One HTTP/1.1 request to the paired desktop, over the same pinned TLS as the WebSocket.
//!
//! The executor's client is mostly its WebSocket, but not only: ad4m-connect checks
//! `GET <base>/health` before it opens the socket, and a few calls (transcription audio) are HTTP.
//! The WebView cannot make those requests itself, since it cannot check a pin. So the plugin does,
//! through here: [`crate::connection::dial`] first, so no request skips the pin rule.
//!
//! Deliberately small: one request per connection (`Connection: close`), text bodies, a response
//! read to its end and capped at 16 MiB. Enough for the health check and JSON; not a general client.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::connection::{dial, kind, runtime, Target, TransportError};
use crate::pin::Pin;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<HttpHeader>,
    pub body: String,
}

/// Why a request got no response. `kind` is one of the connection's kinds
/// (`pin-mismatch`, `host-mismatch`, `unreachable`, `tls`, `closed`).
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum RequestError {
    // `detail`, not `message`: Kotlin exceptions already have a `message`.
    #[error("{kind}: {detail}")]
    Failed { kind: String, detail: String },
}

impl RequestError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        RequestError::Failed {
            kind: kind.to_string(),
            detail: message.into(),
        }
    }
}

impl From<TransportError> for RequestError {
    fn from(e: TransportError) -> Self {
        RequestError::new("bad-input", e.to_string())
    }
}

/// Sends one request to an `https://` URL on the paired desktop and waits for the whole response.
/// Blocks the calling thread (the plugin's), never the shared runtime's.
#[uniffi::export]
pub fn http_request(
    url: String,
    pin: String,
    method: String,
    headers: Vec<HttpHeader>,
    body: Option<String>,
) -> Result<HttpResponse, RequestError> {
    let target = Target::parse_scheme(&url, "https")?;
    let pin = Pin::parse(&pin).map_err(|e| RequestError::new("bad-input", e.to_string()))?;
    if method.is_empty() || !method.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(RequestError::new(
            "bad-input",
            format!("{method:?} is not an HTTP method"),
        ));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    runtime().spawn(async move {
        let result =
            tokio::time::timeout(REQUEST_TIMEOUT, request(target, pin, method, headers, body))
                .await
                .unwrap_or_else(|_| {
                    Err(RequestError::new(kind::CLOSED, "no response within 30 s"))
                });
        let _ = tx.send(result);
    });
    rx.recv()
        .unwrap_or_else(|_| Err(RequestError::new(kind::CLOSED, "the request was dropped")))
}

async fn request(
    target: Target,
    pin: Pin,
    method: String,
    headers: Vec<HttpHeader>,
    body: Option<String>,
) -> Result<HttpResponse, RequestError> {
    let mut tls = dial(&target, pin)
        .await
        .map_err(|(kind, message)| RequestError::new(kind, message))?;

    let host = if target.host.contains(':') {
        format!("[{}]", target.host)
    } else {
        target.host.clone()
    };
    let body = body.unwrap_or_default();
    let mut head = format!(
        "{} {} HTTP/1.1\r\nHost: {host}:{}\r\nConnection: close\r\nContent-Length: {}\r\n",
        method.to_ascii_uppercase(),
        if target.path_and_query.is_empty() {
            "/"
        } else {
            &target.path_and_query
        },
        target.port,
        body.len()
    );
    for h in &headers {
        let name = h.name.to_ascii_lowercase();
        // The framing is this function's; a caller's would contradict it.
        if matches!(
            name.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding"
        ) {
            continue;
        }
        if h.name.contains(['\r', '\n', ':']) || h.value.contains(['\r', '\n']) {
            return Err(RequestError::new(
                "bad-input",
                format!("header {:?} is not allowed", h.name),
            ));
        }
        head.push_str(&format!("{}: {}\r\n", h.name, h.value));
    }
    head.push_str("\r\n");
    tls.write_all(head.as_bytes())
        .await
        .map_err(|e| RequestError::new(kind::CLOSED, e.to_string()))?;
    tls.write_all(body.as_bytes())
        .await
        .map_err(|e| RequestError::new(kind::CLOSED, e.to_string()))?;
    tls.flush()
        .await
        .map_err(|e| RequestError::new(kind::CLOSED, e.to_string()))?;

    let mut raw = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        match tls.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > MAX_RESPONSE {
                    return Err(RequestError::new(
                        kind::CLOSED,
                        "the response is over 16 MiB",
                    ));
                }
            }
            // A server that closes without TLS close_notify, after a complete response, is common.
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof && !raw.is_empty() => break,
            Err(e) => return Err(RequestError::new(kind::CLOSED, e.to_string())),
        }
    }
    parse_response(&raw)
}

fn parse_response(raw: &[u8]) -> Result<HttpResponse, RequestError> {
    let bad = || RequestError::new(kind::CLOSED, "the response is not HTTP/1.1");
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(bad)?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| bad())?;
    let mut lines = head.split("\r\n");
    let status_line = lines.next().ok_or_else(bad)?;
    let status: u16 = status_line
        .split(' ')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(bad)?;
    let headers: Vec<HttpHeader> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| HttpHeader {
            name: n.trim().to_string(),
            value: v.trim().to_string(),
        })
        .collect();
    let rest = &raw[split + 4..];
    let chunked = headers.iter().any(|h| {
        h.name.eq_ignore_ascii_case("transfer-encoding")
            && h.value.to_ascii_lowercase().contains("chunked")
    });
    let body = if chunked {
        dechunk(rest).ok_or_else(bad)?
    } else {
        rest.to_vec()
    };
    // The body the caller sees is the decoded one: drop the framing headers that described the wire.
    let headers = headers
        .into_iter()
        .filter(|h| {
            !h.name.eq_ignore_ascii_case("transfer-encoding")
                && !h.name.eq_ignore_ascii_case("content-length")
        })
        .collect();
    Ok(HttpResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn dechunk(mut data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line_end = data.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&data[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        data = &data[line_end + 2..];
        if size == 0 {
            return Some(out);
        }
        if data.len() < size + 2 {
            return None;
        }
        out.extend_from_slice(&data[..size]);
        data = &data[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_length_framed_response_is_read() {
        let r = parse_response(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok",
        )
        .unwrap();
        assert_eq!((r.status, r.body.as_str()), (200, "ok"));
        assert_eq!(
            r.headers,
            vec![HttpHeader {
                name: "Content-Type".into(),
                value: "text/plain".into()
            }]
        );
    }

    #[test]
    fn a_chunked_response_is_decoded() {
        let r = parse_response(b"HTTP/1.1 404 Not Found\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;x=y\r\nde\r\n0\r\n\r\n").unwrap();
        assert_eq!((r.status, r.body.as_str()), (404, "abcde"));
        assert!(r.headers.is_empty());
    }

    #[test]
    fn garbage_is_refused() {
        assert!(parse_response(b"not http").is_err());
        assert!(
            parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n").is_err()
        );
    }
}
