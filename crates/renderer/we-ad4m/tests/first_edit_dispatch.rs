//! The first edit of a read-only space, with no executor.
//!
//! A local TCP listener completes the WebSocket handshake and then counts
//! text and binary frames. The refusal happens in `WriteHost` before any
//! write is planned, so the stub sees none. CI runs this without
//! `EXECUTOR_PATH`.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::json;
use we_ad4m::{Access, Connection, Runtime, WriteHost};
use we_data::SpaceId;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{ResolvedChild, ResolvedNode, RootSpec, StaticHost, StoreBag};

const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

fn sha1(data: &[u8]) -> [u8; 20] {
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).saturating_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    let mut h = [
        0x6745_2301_u32,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    for chunk in msg.chunks(64) {
        let mut w = [0_u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, word) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0_u8; 20];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn b64(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n =
            (u32::from(bytes[i]) << 16) | (u32::from(bytes[i + 1]) << 8) | u32::from(bytes[i + 2]);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(T[((n >> 6) & 63) as usize] as char);
        out.push(T[(n & 63) as usize] as char);
        i += 3;
    }
    let rest = bytes.len() - i;
    if rest == 1 {
        let n = u32::from(bytes[i]) << 16;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let n = (u32::from(bytes[i]) << 16) | (u32::from(bytes[i + 1]) << 8);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(T[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

fn accept_key(key: &str) -> String {
    b64(&sha1(format!("{key}{GUID}").as_bytes()))
}

#[test]
fn the_websocket_accept_matches_the_rfc() {
    assert_eq!(
        accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
        "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );
}

struct Stub {
    url: String,
    rpc: Arc<AtomicUsize>,
    request: Arc<Mutex<String>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Stub {
    fn start() -> Self {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let rpc = Arc::new(AtomicUsize::new(0));
        let request = Arc::new(Mutex::new(String::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let rpc2 = rpc.clone();
        let request2 = request.clone();
        let stop2 = stop.clone();
        let thread = thread::spawn(move || serve(listener, rpc2, request2, stop2));
        Self {
            url: format!("http://127.0.0.1:{port}"),
            rpc,
            request,
            stop,
            thread: Some(thread),
        }
    }

    fn rpc_frames(&self) -> usize {
        self.rpc.load(Ordering::Relaxed)
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn serve(
    listener: TcpListener,
    rpc: Arc<AtomicUsize>,
    request: Arc<Mutex<String>>,
    stop: Arc<AtomicBool>,
) {
    let sock = loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        match listener.accept() {
            Ok((sock, _)) => break sock,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return,
        }
    };
    let mut sock = sock;
    let _ = sock.set_nonblocking(false);
    let _ = sock.set_read_timeout(Some(Duration::from_secs(2)));
    let Ok(req) = read_http(&mut sock) else {
        return;
    };
    if let Ok(mut slot) = request.lock() {
        *slot = req.clone();
    }
    let Some(key) = header(&req, "Sec-WebSocket-Key") else {
        return;
    };
    let accept = accept_key(key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    if sock.write_all(response.as_bytes()).is_err() {
        return;
    }
    let _ = sock.flush();
    let _ = sock.set_read_timeout(Some(Duration::from_millis(50)));
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match read_opcode(&mut sock) {
            Ok(Some(0x1 | 0x2)) => {
                rpc.fetch_add(1, Ordering::Relaxed);
            }
            Ok(Some(0x8)) | Err(_) => break,
            Ok(Some(_) | None) => {}
        }
    }
}

fn header<'a>(req: &'a str, name: &str) -> Option<&'a str> {
    req.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

fn read_http(sock: &mut TcpStream) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        sock.read_exact(&mut byte)?;
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") || buf.len() > 8192 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// One client frame. `None` is a read timeout. Ping is answered and not
/// counted by the caller.
fn read_opcode(sock: &mut TcpStream) -> std::io::Result<Option<u8>> {
    let mut hdr = [0_u8; 2];
    match sock.read(&mut hdr[..1]) {
        Ok(0) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "eof",
            ))
        }
        Ok(_) => {}
        Err(e)
            if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
        {
            return Ok(None);
        }
        Err(e) => return Err(e),
    }
    sock.read_exact(&mut hdr[1..])?;
    let opcode = hdr[0] & 0x0f;
    let masked = hdr[1] & 0x80 != 0;
    let mut len = u64::from(hdr[1] & 0x7f);
    if len == 126 {
        let mut ext = [0_u8; 2];
        sock.read_exact(&mut ext)?;
        len = u64::from(u16::from_be_bytes(ext));
    } else if len == 127 {
        let mut ext = [0_u8; 8];
        sock.read_exact(&mut ext)?;
        len = u64::from_be_bytes(ext);
    }
    let mut mask = [0_u8; 4];
    if masked {
        sock.read_exact(&mut mask)?;
    }
    let mut payload = vec![0_u8; usize::try_from(len).unwrap_or(0)];
    if !payload.is_empty() {
        sock.read_exact(&mut payload)?;
    }
    if opcode == 0x9 {
        let n = u8::try_from(payload.len()).unwrap_or(125);
        let mut frame = vec![0x8A, n];
        frame.extend_from_slice(&payload[..usize::from(n)]);
        sock.write_all(&frame)?;
    }
    Ok(Some(opcode))
}

struct Open {
    session: Session,
    slot: Arc<Mutex<Option<String>>>,
    stub: Stub,
    rt: Runtime,
}

fn button(invoke: serde_json::Value) -> we_template::SchemaNode {
    // `$localState` sits on the parent. The button's `$setLocal` writes it,
    // and the text reads it. The same shape as the executor write tests.
    serde_json::from_value(json!({
        "type": "Column",
        "$localState": {
            "failed": { "type": "boolean", "initial": false },
            "settled": { "type": "boolean", "initial": false }
        },
        "children": [
            { "type": "we-button", "props": { "onClick": invoke }, "children": ["Go"] },
            { "type": "we-text", "children": [
                { "$": "`failed=${local.failed} settled=${local.settled}`" }
            ]}
        ]
    }))
    .unwrap()
}

fn invoke(target: &str, args: serde_json::Value) -> serde_json::Value {
    json!({
        "$invoke": target,
        "args": args,
        "onError": [{ "$setLocal": "failed", "value": true }],
        "onFinally": [{ "$setLocal": "settled", "value": true }]
    })
}

fn open(invoke: serde_json::Value, shared: bool) -> Open {
    let stub = Stub::start();
    let rt = Runtime::new().unwrap();
    let url = stub.url.clone();
    let seen = stub.request.clone();
    let conn = rt
        .block_on(async {
            tokio::time::timeout(
                Duration::from_secs(5),
                Connection::open(rt.handle(), &url, ""),
            )
            .await
        })
        .unwrap_or_else(|_| panic!("connect timed out\n{}", seen.lock().unwrap()))
        .unwrap_or_else(|e| panic!("connect: {e:#}\n{}", seen.lock().unwrap()));
    let bag = Arc::new(StoreBag::new());
    let mut host = WriteHost::new(
        StaticHost::new(bag.clone()),
        conn,
        SpaceId::new("space-1"),
        bag.clone(),
        Access::ReadOnly,
    );
    host.set_shared(shared);
    let slot = Arc::new(Mutex::new(None));
    host.watch_grant(slot.clone());
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let session = Session::new(
        RootSpec::single(button(invoke), "test"),
        bag,
        screen,
        Box::new(host),
    );
    Open {
        session,
        slot,
        stub,
        rt,
    }
}

fn button_id(root: &ResolvedNode) -> we_template::NodeId {
    fn walk(n: &ResolvedNode) -> Option<we_template::NodeId> {
        if n.ty.as_ref() == "we-button" {
            return Some(n.id.clone());
        }
        n.children.iter().find_map(|c| match c {
            ResolvedChild::Node(n) => walk(n),
            ResolvedChild::Text(_) => None,
        })
    }
    walk(root).expect("the button")
}

fn text(session: &mut Session) -> String {
    let root = session.resolve();
    we_template::normal_form(&root).to_string()
}

fn click(open: &mut Open) {
    let root = open.session.resolve();
    let id = button_id(&root);
    open.session.dispatch(&id, "onClick", Value::Null);
}

fn slot(open: &Open) -> Option<String> {
    open.slot.lock().unwrap().clone()
}

fn notice_text(open: &Open) -> String {
    open.session
        .host_as::<WriteHost>()
        .unwrap()
        .notices()
        .list()
        .iter()
        .map(|n| n.text.clone())
        .collect::<Vec<_>>()
        .join("\n")
}

fn no_rpc(open: &Open) {
    // The runtime has to outlive the socket. Reading it keeps the field live.
    let _ = open.rt.handle();
    thread::sleep(Duration::from_millis(150));
    assert_eq!(
        open.stub.rpc_frames(),
        0,
        "a frame reached the stub executor"
    );
}

#[test]
fn a_read_only_edit_goes_through_dispatch_and_asks() {
    let invoke = invoke(
        "recordStore.updateRecordField",
        json!(["TaskBlock", "rec-1", "title", "Next"]),
    );
    let mut open = open(invoke, false);
    let before = text(&mut open.session);
    assert!(before.contains("failed=false"), "{before}");
    assert!(before.contains("settled=false"), "{before}");
    click(&mut open);
    let after = text(&mut open.session);
    assert!(after.contains("failed=true"), "{after}");
    assert!(after.contains("settled=true"), "{after}");
    assert_eq!(slot(&open).as_deref(), Some("space-1"));
    let notices = notice_text(&open);
    assert!(notices.contains("read-only"), "{notices}");
    no_rpc(&open);
}

#[test]
fn a_template_invoke_cannot_navigate() {
    let mut open = open(
        invoke("spaceStore.navigateToSpace", json!(["we-root"])),
        false,
    );
    click(&mut open);
    let dropped = open
        .session
        .host_as::<WriteHost>()
        .unwrap()
        .fallback
        .dropped
        .clone();
    assert!(
        dropped.iter().any(|t| t == "spaceStore.navigateToSpace"),
        "{dropped:?}"
    );
    assert!(slot(&open).is_none(), "{:?}", slot(&open));
    let after = text(&mut open.session);
    assert!(after.contains("failed=false"), "{after}");
    assert!(after.contains("settled=false"), "{after}");
    no_rpc(&open);
}

#[test]
fn a_shared_space_edit_does_not_ask() {
    let invoke = invoke(
        "recordStore.updateRecordField",
        json!(["TaskBlock", "rec-1", "title", "Next"]),
    );
    let mut open = open(invoke, true);
    click(&mut open);
    let _ = text(&mut open.session);
    assert!(slot(&open).is_none(), "{:?}", slot(&open));
    let notices = notice_text(&open);
    assert!(notices.contains("shared space"), "{notices}");
    no_rpc(&open);
}
