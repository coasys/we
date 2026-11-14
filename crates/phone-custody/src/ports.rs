//! The ports `ViaStore` takes, as the phone supplies them: the store's HTTP from the app, the device
//! key and the enc key over the seeds [`crate::Sealer`] keeps sealed, and the system clock and
//! random source.
//!
//! **HTTP is a blocking foreign trait** ([`StoreTransport`]). `ViaStore`'s `HttpClient` is
//! `async_trait(?Send)`, and the flows that call it are driven here by `futures-executor`'s
//! `block_on` on the thread that called into Rust. That thread is always one the app runs off its
//! main thread already (the plugin's executor, or a holder session's own thread), so a blocking
//! `send` costs nothing: nothing else waits on that thread. An async foreign trait would make
//! UniFFI's foreign futures, a Kotlin coroutine scope and a Rust executor that polls both, to get
//! the same one-request-at-a-time behaviour the flows have anyway: each awaits its reply before it
//! sends the next.
//!
//! What crosses to the app here is a request to send: a URL, headers (a device-signed
//! `X-Coasys-Request`, a pre-join `X-Coasys-Inbox`), and the canonical JSON body, which carries
//! signed events, sealed messages and sealed records. No seed and no record key is ever in it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ad4m_hash_chain::Multikey;
use ad4m_identity_client::{
    EncKey, EncOpenError, HttpClient, HttpError, HttpRequest, HttpResponse, Secret,
};
use ad4m_identity_core::inbox::{InboxAddress, InboxError, InboxPayload};
use ad4m_identity_core::record::{RecordError, RECORD_KEY_LEN};
use ad4m_identity_core::X25519Secret;
use async_trait::async_trait;
use zeroize::Zeroizing;

use crate::{Sealer, WipeOnDrop, ENC_LABEL};

/// One header of a [`StoreRequest`] or a [`StoreReply`].
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct Header {
    pub name: String,
    pub value: String,
}

/// One HTTPS request to the identity store.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct StoreRequest {
    /// `GET`, `POST`, `PUT` or `DELETE`.
    pub method: String,
    pub url: String,
    pub headers: Vec<Header>,
    /// Empty for a request with no body.
    pub body: Vec<u8>,
}

/// The store's answer. A status the store answered, whatever it is, is a reply; only a request
/// that got no answer is a [`TransportError`].
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct StoreReply {
    pub status: u16,
    pub headers: Vec<Header>,
    pub body: Vec<u8>,
}

/// No answer: the network is down, the store did not answer in time, the TLS handshake failed.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum TransportError {
    #[error("{reason}")]
    Failed { reason: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for TransportError {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        TransportError::Failed { reason: e.reason }
    }
}

/// The app's HTTP client for the identity store (on Android, `HttpURLConnection` over the
/// platform's TLS). Blocking: it is called on a background thread, and answers when the store
/// does.
#[uniffi::export(with_foreign)]
pub trait StoreTransport: Send + Sync {
    fn send(&self, request: StoreRequest) -> Result<StoreReply, TransportError>;
}

/// [`StoreTransport`] as `ViaStore`'s `HttpClient`. With a `cancelled` flag (a holder's link),
/// every request after the flag is set fails without being sent, so a flow waiting on the store
/// stops at its next request.
pub struct Transport {
    inner: Arc<dyn StoreTransport>,
    cancelled: Option<Arc<AtomicBool>>,
}

/// What a request after a cancel fails with.
pub const CANCELLED: &str = "cancelled on this phone";

impl Transport {
    pub fn new(inner: Arc<dyn StoreTransport>, cancelled: Option<Arc<AtomicBool>>) -> Self {
        Transport { inner, cancelled }
    }
}

#[async_trait(?Send)]
impl HttpClient for Transport {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        if self
            .cancelled
            .as_ref()
            .is_some_and(|c| c.load(Ordering::SeqCst))
        {
            return Err(HttpError(CANCELLED.into()));
        }
        let headers = request
            .headers
            .into_iter()
            .map(|(name, value)| Header { name, value })
            .collect();
        let reply = self
            .inner
            .send(StoreRequest {
                method: request.method,
                url: request.url,
                headers,
                body: request.body,
            })
            .map_err(|e| HttpError(e.to_string()))?;
        Ok(HttpResponse {
            status: reply.status,
            headers: reply
                .headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect(),
            body: reply.body,
        })
    }
}

/// The phone's enc key behind `ViaStore`'s `EncKey`: the seed stays sealed by [`Sealer`] and is
/// opened for each message or record key, checked against the enc key on record, and wiped when
/// the open is done. A sealer that refuses (the Keystore answered an error) is
/// `EncOpenError::Unavailable`, so the store keeps the message for the next try; only bytes that do
/// not open with this key are `Sealed`.
pub struct PhoneEncKey {
    sealer: Arc<dyn Sealer>,
    sealed: Vec<u8>,
    enc: Multikey,
}

impl PhoneEncKey {
    pub fn new(sealer: Arc<dyn Sealer>, sealed: Vec<u8>, enc: Multikey) -> Self {
        PhoneEncKey {
            sealer,
            sealed,
            enc,
        }
    }

    /// The X25519 secret, for one open. `Err` is the sentence an `Unavailable` keeps.
    fn secret(&self) -> Result<X25519Secret, String> {
        let _wipe = WipeOnDrop(self.sealer.as_ref());
        let plain = Zeroizing::new(
            self.sealer
                .open(ENC_LABEL.into(), self.sealed.clone())
                .map_err(|e| format!("the key store did not open the enc key: {e}"))?,
        );
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            plain
                .as_slice()
                .try_into()
                .map_err(|_| "the sealed enc key is not 32 bytes".to_string())?,
        );
        let secret = X25519Secret::from(*seed);
        if ad4m_identity_core::x25519_multikey_of(&secret) != self.enc {
            return Err("the sealed enc key does not open to the key on record".into());
        }
        Ok(secret)
    }
}

impl EncKey for PhoneEncKey {
    fn enc(&self) -> Multikey {
        self.enc.clone()
    }

    fn open(
        &self,
        address: &InboxAddress,
        sealed: &str,
    ) -> Result<InboxPayload, EncOpenError<InboxError>> {
        let secret = self.secret().map_err(EncOpenError::Unavailable)?;
        ad4m_identity_core::inbox::open(&secret, address, sealed).map_err(EncOpenError::Sealed)
    }

    fn unwrap_record_key(
        &self,
        scid: &str,
        wrapped: &str,
    ) -> Result<Secret<[u8; RECORD_KEY_LEN]>, EncOpenError<RecordError>> {
        let secret = self.secret().map_err(EncOpenError::Unavailable)?;
        ad4m_identity_core::record::unwrap_key(wrapped, scid, &secret)
            .map(|key| Secret::new(*key))
            .map_err(EncOpenError::Sealed)
    }
}
