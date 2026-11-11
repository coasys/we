//! The custody service as a sidecar process: see `we_custody::sidecar`.
//!
//! `we-custody --executor-port <port> [--custody-dir <dir>]`, with the executor's custody credential
//! as the first line of stdin and the requests after it. Exits 0 when stdin closes, 2 on a bad
//! configuration: an unknown argument, no credential line, or a custody credential in the
//! environment.
//!
//! `we-custody wallet-passphrase read|make --data-folder <dir>` instead answers one line about the
//! executor's wallet passphrase in the keyring (`we_custody::wallet`) and exits: the Electron
//! supervisor's stopgap.
//!
//! `we-custody storage-secret read|make --data-folder <dir>`, or `storage-secret derive
//! --keyring-id <hex> [--new]` with the passphrase as a JSON line on stdin, answers one line about
//! the executor's storage secret (`we_custody::storage_secret`) and exits.

use std::process::ExitCode;

use we_custody::sidecar::{self, Config, Stopped};

fn main() -> ExitCode {
    sidecar::log_to_stderr();
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().map(String::as_str) == Some("wallet-passphrase") {
        return we_custody::wallet::main(args.skip(1));
    }
    if args.peek().map(String::as_str) == Some("storage-secret") {
        return we_custody::storage_secret::main(args.skip(1));
    }
    let config = match Config::parse(std::env::args().skip(1), |name| std::env::var(name).ok()) {
        Ok(config) => config,
        Err(problem) => {
            eprintln!("[we-custody] {problem}");
            return ExitCode::from(2);
        }
    };
    match sidecar::main(config) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Stopped::NoCredential(problem)) => {
            eprintln!("[we-custody] {problem}");
            ExitCode::from(2)
        }
        Err(e) => {
            eprintln!("[we-custody] {e}");
            ExitCode::FAILURE
        }
    }
}
