//! The one rule the phone trusts a desktop by.
//!
//! A server certificate is accepted when, and only when:
//!
//! 1. the SHA-256 of its SubjectPublicKeyInfo equals the pin from the QR code, and
//! 2. it names the host the phone dialled: a DNS SAN for a name, an IP SAN for an address literal.
//!    The Common Name is not read (RFC 6125 §6.4.4, and what every browser does), so a certificate
//!    with no SAN names nothing and is refused.
//!
//! Chains, issuers, trust stores and validity dates play no part: the pin is the whole of the trust.
//! The handshake signature is still checked against the certificate's key, so a server that copied
//! the certificate without its private key cannot finish the handshake.

use std::sync::{Arc, Mutex};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, SignatureScheme};

use crate::pin::{spki_sha256, Pin};

/// Why the verifier refused a certificate. The TLS error that reaches the caller carries no more
/// than "invalid certificate", so the verifier keeps its own reason for the connection to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    PinMismatch,
    HostMismatch,
    Unreadable,
}

#[derive(Debug)]
pub struct PinnedVerifier {
    pin: Pin,
    algorithms: WebPkiSupportedAlgorithms,
    refusal: Mutex<Option<Refusal>>,
}

impl PinnedVerifier {
    pub fn new(pin: Pin, provider: &CryptoProvider) -> Arc<Self> {
        Arc::new(Self {
            pin,
            algorithms: provider.signature_verification_algorithms,
            refusal: Mutex::new(None),
        })
    }

    /// The reason for the last refusal, if there was one.
    pub fn refusal(&self) -> Option<Refusal> {
        *self.refusal.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn refuse(&self, why: Refusal) -> Result<ServerCertVerified, rustls::Error> {
        *self.refusal.lock().unwrap_or_else(|e| e.into_inner()) = Some(why);
        Err(rustls::Error::InvalidCertificate(match why {
            Refusal::PinMismatch => CertificateError::ApplicationVerificationFailure,
            Refusal::HostMismatch => CertificateError::NotValidForName,
            Refusal::Unreadable => CertificateError::BadEncoding,
        }))
    }
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let Ok(spki) = spki_sha256(end_entity) else {
            return self.refuse(Refusal::Unreadable);
        };
        if spki != self.pin.0 {
            return self.refuse(Refusal::PinMismatch);
        }
        let Ok(cert) = webpki::EndEntityCert::try_from(end_entity) else {
            return self.refuse(Refusal::Unreadable);
        };
        if cert.verify_is_valid_for_subject_name(server_name).is_err() {
            return self.refuse(Refusal::HostMismatch);
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        // The client offers TLS 1.3 only, so this is never reached; refuse rather than trust.
        Err(rustls::Error::PeerIncompatible(
            rustls::PeerIncompatible::Tls13RequiredForQuic,
        ))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}
