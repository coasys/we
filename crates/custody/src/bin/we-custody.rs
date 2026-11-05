//! The custody service as a sidecar process: see `we_custody::sidecar`.
//!
//! `we-custody --executor-port <port> [--custody-dir <dir>]`, with the executor's admin credential in
//! `AD4M_ADMIN_CREDENTIAL`. Exits 0 when stdin closes, 2 on a bad configuration.

use std::process::ExitCode;

use we_custody::sidecar::{self, Config};

fn main() -> ExitCode {
    sidecar::log_to_stderr();
    let config = match Config::parse(std::env::args().skip(1), |name| std::env::var(name).ok()) {
        Ok(config) => config,
        Err(problem) => {
            eprintln!("[we-custody] {problem}");
            return ExitCode::from(2);
        }
    };
    match sidecar::main(config) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("[we-custody] {e}");
            ExitCode::FAILURE
        }
    }
}
