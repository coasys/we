//! What the desktop host offers the base connect screen.
//!
//! Slice 1 offers one row: this computer. The click dials an explicit
//! loopback URL through the existing [`crate::connect::ConnectFlow`], so a
//! remembered remote URL cannot answer the click.

use std::path::{Path, PathBuf};

use crate::connect::{scrub, ConnectSettings};

/// This computer, as the base template's connection row names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ThisComputer {
    pub id: &'static str,
    pub kind: &'static str,
    pub icon: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
}

/// The only connection slice 1 offers.
pub fn this_computer() -> ThisComputer {
    ThisComputer {
        id: "this-device",
        kind: "this-device",
        icon: "laptop",
        label: "This computer",
        detail: "Available while this computer is on",
    }
}

/// How a failed connect attempt is shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FailureClass {
    /// The executor did not answer. The screen uses its own sentence.
    Unreachable,
    /// Any other failure. `reason` is the sentence the connect stage shows.
    Refused { reason: String },
}

/// Classify a [`crate::connect::ConnectPhase::Failed`] reason.
///
/// The flow's typed error is a string in this build. The match is on the
/// words that string already carries.
pub fn classify_failure(reason: &str) -> FailureClass {
    let lower = reason.to_ascii_lowercase();
    if lower.contains("does not answer")
        || lower.contains("no ad4m executor")
        || lower.contains("connection refused")
        || lower.contains("timed out")
        || lower.contains("os error")
    {
        FailureClass::Unreachable
    } else {
        FailureClass::Refused {
            reason: scrub(reason),
        }
    }
}

/// The URL a click on This computer dials.
///
/// An `--executor-url` wins. Otherwise a port file that is a port number
/// or a loopback `http` URL becomes `http://127.0.0.1:{port}`. Anything
/// else, including a non-loopback URL in the port file, is
/// `http://127.0.0.1:12000`. The caller writes the result into
/// [`ConnectSettings::url`] before [`crate::connect::ConnectFlow::start`],
/// so discovery cannot replace it.
pub fn explicit_local_url(settings: &ConnectSettings) -> String {
    if let Some(url) = settings
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        return url.to_string();
    }
    let path = settings.port_file.clone().unwrap_or_else(default_port_file);
    if let Some(port) = read_local_port(&path) {
        return format!("http://127.0.0.1:{port}");
    }
    "http://127.0.0.1:12000".to_string()
}

fn default_port_file() -> PathBuf {
    let mut home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.push(".ad4m");
    home.push("executor-port");
    home
}

fn read_local_port(path: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim();
    if let Ok(port) = text.parse::<u16>() {
        return (port > 0).then_some(port);
    }
    loopback_port(text)
}

fn loopback_port(text: &str) -> Option<u16> {
    let text = text.trim().trim_end_matches('/');
    let rest = text
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| text.strip_prefix("http://localhost:"))
        .or_else(|| text.strip_prefix("http://[::1]:"))?;
    if rest.contains('/') || rest.contains('?') || rest.contains('#') {
        return None;
    }
    let port: u16 = rest.parse().ok()?;
    (port > 0).then_some(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_url_wins_over_the_port_file() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "3999").unwrap();
        let settings = ConnectSettings {
            url: Some("http://127.0.0.1:12001".into()),
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:12001");
    }

    #[test]
    fn a_port_number_becomes_loopback() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "4123\n").unwrap();
        let settings = ConnectSettings {
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:4123");
    }

    #[test]
    fn a_loopback_url_in_the_port_file_keeps_its_port() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "http://localhost:4124/").unwrap();
        let settings = ConnectSettings {
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:4124");
    }

    #[test]
    fn a_remote_port_file_does_not_win() {
        let dir = tempfile::tempdir().unwrap();
        let port_file = dir.path().join("executor-port");
        std::fs::write(&port_file, "http://example.test:9").unwrap();
        let settings = ConnectSettings {
            port_file: Some(port_file),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:12000");
    }

    #[test]
    fn a_missing_port_file_is_the_default_port() {
        let settings = ConnectSettings {
            port_file: Some(PathBuf::from("/no/such/executor-port")),
            ..ConnectSettings::default()
        };
        assert_eq!(explicit_local_url(&settings), "http://127.0.0.1:12000");
    }

    #[test]
    fn refused_and_unreachable_are_different() {
        assert_eq!(
            classify_failure("connection refused"),
            FailureClass::Unreachable
        );
        assert_eq!(
            classify_failure("The executor at http://127.0.0.1:1 does not answer."),
            FailureClass::Unreachable
        );
        assert_eq!(
            classify_failure("No AD4M executor found."),
            FailureClass::Unreachable
        );
        match classify_failure("the executor refused this app's token — connect again") {
            FailureClass::Refused { reason } => assert!(reason.contains("refused"), "{reason}"),
            FailureClass::Unreachable => panic!("a refusal was classed unreachable"),
        }
    }
}
