//! The pin: SHA-256 of a certificate's SubjectPublicKeyInfo, as the QR code carries it.
//!
//! Written as base64url without padding (43 characters). Hex (64 characters) is read as well, so a
//! pin copied out of `openssl` output works, but the crate always writes base64url.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// Why a pin or a certificate could not be read.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PinError {
    #[error("the pin is neither 43 characters of base64url nor 64 of hex")]
    Format,
    #[error("the certificate could not be parsed")]
    Certificate,
}

/// A parsed pin.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Pin(pub [u8; 32]);

impl std::fmt::Debug for Pin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Pin({})", self.to_b64url())
    }
}

impl Pin {
    /// Reads base64url (padding tolerated) or hex.
    pub fn parse(text: &str) -> Result<Self, PinError> {
        let text = text.trim();
        if text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit()) {
            let mut out = [0u8; 32];
            for (i, chunk) in text.as_bytes().chunks(2).enumerate() {
                let hi = hex_value(chunk[0]);
                let lo = hex_value(chunk[1]);
                out[i] = (hi << 4) | lo;
            }
            return Ok(Pin(out));
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(text.trim_end_matches('='))
            .map_err(|_| PinError::Format)?;
        let out: [u8; 32] = bytes.try_into().map_err(|_| PinError::Format)?;
        Ok(Pin(out))
    }

    pub fn to_b64url(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }
}

fn hex_value(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        _ => b - b'A' + 10,
    }
}

/// SHA-256 of the SubjectPublicKeyInfo in a DER certificate.
pub fn spki_sha256(cert_der: &[u8]) -> Result<[u8; 32], PinError> {
    let (_, cert) =
        x509_parser::parse_x509_certificate(cert_der).map_err(|_| PinError::Certificate)?;
    Ok(Sha256::digest(cert.tbs_certificate.subject_pki.raw).into())
}

/// The pin of a DER certificate.
pub fn pin_from_der(cert_der: &[u8]) -> Result<Pin, PinError> {
    spki_sha256(cert_der).map(Pin)
}

/// The pin of the first certificate in a PEM text.
pub fn pin_from_pem(pem: &str) -> Result<Pin, PinError> {
    let (_, block) =
        x509_parser::pem::parse_x509_pem(pem.as_bytes()).map_err(|_| PinError::Certificate)?;
    pin_from_der(&block.contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_and_base64url_read_the_same_pin() {
        let pin = Pin([0xab; 32]);
        let hex: String = pin.0.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(Pin::parse(&hex).unwrap(), pin);
        assert_eq!(Pin::parse(&hex.to_uppercase()).unwrap(), pin);
        assert_eq!(Pin::parse(&pin.to_b64url()).unwrap(), pin);
        assert_eq!(pin.to_b64url().len(), 43);
    }

    #[test]
    fn a_short_pin_is_refused() {
        assert_eq!(Pin::parse("abc"), Err(PinError::Format));
        assert_eq!(
            Pin::parse(&URL_SAFE_NO_PAD.encode([1u8; 31])),
            Err(PinError::Format)
        );
    }

    #[test]
    fn pem_and_der_give_the_same_pin() {
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = rcgen::CertificateParams::new(vec!["desk.local".to_string()])
            .unwrap()
            .self_signed(&key)
            .unwrap();
        let from_pem = pin_from_pem(&cert.pem()).unwrap();
        let from_der = pin_from_der(cert.der()).unwrap();
        assert_eq!(from_pem, from_der);
        // The SPKI is the key's, so the pin is SHA-256 of the key's public DER.
        use rcgen::PublicKeyData;
        let expected: [u8; 32] = Sha256::digest(key.subject_public_key_info()).into();
        assert_eq!(from_der.0, expected);
    }
}
