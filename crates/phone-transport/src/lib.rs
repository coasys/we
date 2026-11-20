//! The phone's pinned connection to the desktop executor.
//!
//! [`Connection::connect`] opens a TLS 1.3 WebSocket to a `wss://` URL and accepts the server only
//! under [`verifier::PinnedVerifier`]'s rule: the certificate's public key hashes to the pin, and
//! the certificate names the host that was dialled. Everything is exported through uniffi; the
//! Kotlin and Swift bindings are generated from this library by `uniffi-bindgen`.

pub mod connection;
pub mod http;
pub mod pin;
pub mod verifier;

pub use connection::{
    kind, live_connections, runtime_workers, Connection, ConnectionListener, TransportError,
};
pub use http::{http_request, HttpHeader, HttpResponse, RequestError};
pub use pin::{pin_from_der, spki_sha256, Pin, PinError};

uniffi::setup_scaffolding!();
