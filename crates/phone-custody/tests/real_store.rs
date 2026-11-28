//! Make, replace and restore on two phones against a real `identity-store` binary over HTTP, at
//! the store's default proof-of-work cost: the path a phone with no computer takes, end to end.
//!
//! Ignored by default (it needs the binary and spends a proof of work):
//!
//! ```sh
//! IDENTITY_STORE_BIN=/path/to/identity-store cargo test --test real_store -- --ignored
//! ```
//!
//! The store runs on a free `127.0.0.1` port with its own temporary folder, and is stopped when
//! the test ends.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use we_phone_custody::{
    DeviceKeys, Header, MasterSealError, MasterSealer, PhoneIdentity, PhoneInput, PhoneScreen,
    SealError, Sealer, StoreConfig, StoreReply, StoreRequest, StoreTransport, TransportError,
};

/// The store's process, stopped when dropped.
struct Store {
    child: Child,
    url: String,
    key: String,
    _dir: tempfile::TempDir,
}

impl Drop for Store {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn store() -> Store {
    let bin = std::env::var("IDENTITY_STORE_BIN")
        .expect("IDENTITY_STORE_BIN names the identity-store binary to run");
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(bin)
        .env("IDENTITY_STORE_LISTEN", "127.0.0.1:0")
        .env("IDENTITY_STORE_KEY", dir.path().join("store-key"))
        .env("IDENTITY_STORE_DB", dir.path().join("store.sqlite"))
        .env_remove("POW_BITS")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("the identity store starts");
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    // `identity-store listening on http://<addr> store-key <multikey>`
    let mut words = line.split_whitespace();
    let url = words
        .find(|w| w.starts_with("http://"))
        .unwrap_or_else(|| panic!("the store's first line: {line}"))
        .to_string();
    let key = line
        .split_whitespace()
        .skip_while(|w| *w != "store-key")
        .nth(1)
        .unwrap_or_else(|| panic!("the store's key: {line}"))
        .to_string();
    Store {
        child,
        url,
        key,
        _dir: dir,
    }
}

/// HTTP/1.1 over a plain socket, one connection per request: the app's transport, in the
/// smallest form a test needs.
struct Http {
    /// The bits of each proof of work sent with a new log's incept.
    appends: Mutex<Vec<u64>>,
}

fn chunked(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let end = body.windows(2).position(|w| w == b"\r\n").unwrap();
        let size = usize::from_str_radix(
            std::str::from_utf8(&body[..end])
                .unwrap()
                .split(';')
                .next()
                .unwrap()
                .trim(),
            16,
        )
        .unwrap();
        body = &body[end + 2..];
        if size == 0 {
            return out;
        }
        out.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
    }
}

impl StoreTransport for Http {
    fn send(&self, request: StoreRequest) -> Result<StoreReply, TransportError> {
        let failed = |e: std::io::Error| TransportError::Failed {
            reason: e.to_string(),
        };
        let rest = request.url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
        let path = if path.is_empty() { "/" } else { path };
        let mut stream = TcpStream::connect(host).map_err(failed)?;
        let mut head = format!(
            "{} {path} HTTP/1.1\r\nhost: {host}\r\nconnection: close\r\ncontent-length: {}\r\n",
            request.method,
            request.body.len()
        );
        for h in &request.headers {
            head.push_str(&format!("{}: {}\r\n", h.name, h.value));
        }
        head.push_str("\r\n");
        stream.write_all(head.as_bytes()).map_err(failed)?;
        stream.write_all(&request.body).map_err(failed)?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(failed)?;
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&raw[..split]).to_string();
        let mut lines = head.split("\r\n");
        let status: u16 = lines
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers: Vec<Header> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(n, v)| Header {
                name: n.trim().to_lowercase(),
                value: v.trim().to_string(),
            })
            .collect();
        let body = &raw[split + 4..];
        let body = if headers
            .iter()
            .any(|h| h.name == "transfer-encoding" && h.value.contains("chunked"))
        {
            chunked(body)
        } else {
            body.to_vec()
        };
        if request.method == "POST" && request.url.ends_with("/events") {
            let sent: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            if let Some(bits) = sent["pow"]["bits"].as_u64() {
                self.appends.lock().unwrap().push(bits);
            }
        }
        Ok(StoreReply {
            status,
            headers,
            body,
        })
    }
}

/// The device-key sealer: the label, then the bytes XORed.
struct DeviceSealer;

impl Sealer for DeviceSealer {
    fn seal(&self, label: String, plaintext: Vec<u8>) -> Result<Vec<u8>, SealError> {
        let mut out = label.into_bytes();
        out.push(0);
        out.extend(plaintext.iter().map(|b| b ^ 0x5a));
        Ok(out)
    }
    fn open(&self, label: String, sealed: Vec<u8>) -> Result<Vec<u8>, SealError> {
        let mut prefix = label.into_bytes();
        prefix.push(0);
        Ok(sealed[prefix.len()..].iter().map(|b| b ^ 0x5a).collect())
    }
    fn wipe(&self) {}
}

/// The master sealer, every prompt touched.
struct Keystore;

impl MasterSealer for Keystore {
    fn protection(&self) -> String {
        "strongbox".into()
    }
    fn seal(&self, label: String, plain: Vec<u8>, _: String) -> Result<Vec<u8>, MasterSealError> {
        let mut out = label.into_bytes();
        out.push(0);
        out.extend(plain.iter().map(|b| b ^ 0xa5));
        Ok(out)
    }
    fn open(&self, label: String, sealed: Vec<u8>, _: String) -> Result<Vec<u8>, MasterSealError> {
        let mut prefix = label.into_bytes();
        prefix.push(0);
        Ok(sealed[prefix.len()..].iter().map(|b| b ^ 0xa5).collect())
    }
    fn wipe(&self) {}
}

fn phone(store: &Store, http: &Arc<Http>) -> (tempfile::TempDir, Arc<PhoneIdentity>) {
    let dir = tempfile::tempdir().unwrap();
    let keys =
        DeviceKeys::open(dir.path().to_string_lossy().into(), Arc::new(DeviceSealer)).unwrap();
    keys.create().unwrap();
    let identity = PhoneIdentity::new(
        keys,
        http.clone(),
        Arc::new(Keystore),
        StoreConfig {
            url: store.url.clone(),
            keys: vec![store.key.clone()],
        },
    )
    .unwrap();
    (dir, identity)
}

#[test]
#[ignore = "runs the identity-store binary named by IDENTITY_STORE_BIN"]
fn make_replace_and_restore_against_the_store_binary() {
    let store = store();
    let http = Arc::new(Http {
        appends: Mutex::new(Vec::new()),
    });

    // Make, on the first phone.
    let (_first_dir, first) = phone(&store, &http);
    let steps = first.start_make(false).unwrap();
    let PhoneScreen::ShowWords { words } = steps.next().unwrap() else {
        panic!("the words");
    };
    let PhoneScreen::ConfirmWords { positions, .. } = steps.step(PhoneInput::WordsWritten).unwrap()
    else {
        panic!("two asked back");
    };
    steps
        .step(PhoneInput::ConfirmWords {
            first: words[positions[0] as usize - 1].clone(),
            second: words[positions[1] as usize - 1].clone(),
        })
        .unwrap();
    let started = Instant::now();
    let made = steps
        .step(PhoneInput::NameDevice {
            name: Some("First phone".into()),
        })
        .unwrap();
    let took: Duration = started.elapsed();
    let PhoneScreen::IdentityReady { did, key_id, .. } = made else {
        panic!("expected the identity, got {made:?}");
    };
    assert_eq!(key_id, "d1");
    let solved = http.appends.lock().unwrap().clone();
    assert_eq!(
        solved,
        vec![22],
        "the incept went out once, with a proof at the store's default bits"
    );
    eprintln!("naming the device to a published identity, the proof of work included: {took:?}");

    // Replace, on the same phone.
    let steps = first.start_rotate(false).unwrap();
    steps.next().unwrap();
    let replaced = steps
        .step(PhoneInput::TwelveWords {
            words: words.join(" "),
        })
        .unwrap();
    assert!(
        matches!(replaced, PhoneScreen::MasterReplaced { index: 1, .. }),
        "{replaced:?}"
    );

    // Restore, on a second phone, locking the first one out.
    let (_second_dir, second) = phone(&store, &http);
    let steps = second.start_restore(false).unwrap();
    steps.next().unwrap();
    let listed = steps
        .step(PhoneInput::TwelveWords {
            words: words.join(" "),
        })
        .unwrap();
    let PhoneScreen::RestoreDevices { devices, .. } = listed else {
        panic!("expected the devices, got {listed:?}");
    };
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].name.as_deref(), Some("First phone"));
    assert_eq!(devices[0].kind.as_deref(), Some("phone-app"));
    let restored = steps
        .step(PhoneInput::LockOut {
            key_ids: vec!["d1".into()],
            name: Some("Second phone".into()),
        })
        .unwrap();
    let PhoneScreen::Restored {
        did: restored_did,
        revoked,
        ..
    } = restored
    else {
        panic!("expected restored, got {restored:?}");
    };
    assert_eq!(restored_did, did);
    assert_eq!(revoked, vec!["d1".to_string()]);
    let status = second.status().unwrap();
    assert_eq!(status.master_index, Some(2));
    assert!(
        first.status().unwrap().revoked.is_some(),
        "the first phone is locked out"
    );
}
