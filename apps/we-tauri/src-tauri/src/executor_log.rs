//! The executor's log, on disk, beside the account it belongs to.
//!
//! The same files, by the same rules, as the Electron host's `electron/executorLog.js` — both run
//! against the same accounts, so they have to agree. The reasoning for the location, the name, the
//! five kept runs and the size limit is written there once.
//!
//! What differs is how output reaches the file. Electron runs the executor as a child and can simply
//! copy its stdout. Here it runs in this process, so there is no stream to copy: instead this is
//! handed to the executor as its logger's target, before the executor sets up its own. Everything
//! logged through the `log` crate lands here — the executor's own lines, JS `console.*` from its
//! languages, and Holochain's `tracing` events, which reach `log` when no subscriber is set, exactly
//! as they do under the CLI. What does not: a bare `println!`, which is not logging and stays on
//! stdout. A panic is caught separately, by `install_panic_hook`.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const LOG_FILE_NAME: &str = "ad4m.log";
/// Runs kept, the current one included.
pub const KEPT_RUNS: usize = 5;
pub const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// `ad4m.log` for the current run, `ad4m.<n>.log` for the run `n` starts ago.
pub fn log_file_name(index: usize) -> String {
    if index == 0 {
        LOG_FILE_NAME.to_string()
    } else {
        format!("ad4m.{index}.log")
    }
}

/// Shift the previous runs down one place, dropping the oldest, so `ad4m.log` is free for this one.
///
/// Best effort per file: a copy that cannot be moved costs one old run, which is no reason to start
/// the executor without a log.
pub fn rotate_logs(dir: &Path, keep: usize) {
    for index in (1..keep).rev() {
        let from = dir.join(log_file_name(index - 1));
        if from.exists() {
            let _ = fs::rename(&from, dir.join(log_file_name(index)));
        }
    }
}

/// Where an ANSI escape sequence split across writes had got to.
#[derive(Clone, Copy, PartialEq)]
enum Escape {
    Text,
    Escape,
    Csi,
}

/// Removes ANSI escape sequences, carrying one split across writes. Byte-level, for the same reason
/// as the JS version: a write boundary can fall inside a multi-byte character too.
fn strip_ansi(state: &mut Escape, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    for &byte in bytes {
        match *state {
            Escape::Text if byte == 0x1b => *state = Escape::Escape,
            Escape::Text => out.push(byte),
            Escape::Escape => {
                *state = if byte == b'[' {
                    Escape::Csi
                } else {
                    Escape::Text
                }
            }
            Escape::Csi if (0x40..=0x7e).contains(&byte) => *state = Escape::Text,
            Escape::Csi => {}
        }
    }
    out
}

/// The current UTC time as `2026-09-15T10:00:00.123Z`, matching the Electron host's `HOST` lines.
/// Written out rather than pulled in: this crate has no date library, and it needs only this.
fn utc_timestamp(since_epoch: std::time::Duration) -> String {
    let secs = since_epoch.as_secs();
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Days since the epoch to a civil date — Howard Hinnant's `civil_from_days`.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60,
        since_epoch.subsec_millis()
    )
}

struct Sink {
    file: Option<File>,
    written: u64,
    max_bytes: u64,
    capped: bool,
    escape: Escape,
}

impl Sink {
    fn append(&mut self, bytes: &[u8]) {
        if self.capped || bytes.is_empty() {
            return;
        }
        let Some(file) = self.file.as_mut() else {
            return;
        };
        if self.written + bytes.len() as u64 > self.max_bytes {
            self.capped = true;
            let _ = write!(
                file,
                "\n[{} HOST] This log reached its size limit; later output is not kept.\n",
                utc_timestamp(now())
            );
            return;
        }
        // A failed write (disk full) drops that line; the terminal copy is unaffected.
        if file.write_all(bytes).is_ok() {
            self.written += bytes.len() as u64;
        }
    }
}

fn now() -> std::time::Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

/// This run's log. Cheap to clone; every clone writes to the same file.
///
/// As a `Write` it is the executor logger's target: each record goes to stdout as it is, so the
/// terminal in development reads as before, and to the file with its colour codes removed.
#[derive(Clone)]
pub struct ExecutorLog {
    sink: Arc<Mutex<Sink>>,
    path: PathBuf,
}

impl ExecutorLog {
    /// Open this run's log in `dir`, rotating the previous ones first.
    ///
    /// Never fails: when the file cannot be opened it says so and the log copies to stdout only. The
    /// executor starts either way; a log is not worth refusing to run over.
    pub fn open(dir: &Path) -> Self {
        Self::open_with(dir, KEPT_RUNS, MAX_FILE_BYTES)
    }

    fn open_with(dir: &Path, keep: usize, max_bytes: u64) -> Self {
        let path = dir.join(LOG_FILE_NAME);
        let file = fs::create_dir_all(dir)
            .and_then(|()| {
                rotate_logs(dir, keep);
                File::create(&path)
            })
            .map_err(|error| {
                eprintln!(
                    "[main] Could not open the executor log at {}: {error}",
                    path.display()
                )
            })
            .ok();
        ExecutorLog {
            sink: Arc::new(Mutex::new(Sink {
                file,
                written: 0,
                max_bytes,
                capped: false,
                escape: Escape::Text,
            })),
            path,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// A line from this host, printed and written, marked so it reads apart from the executor's own.
    pub fn host(&self, message: &str) {
        println!("{message}");
        let line = format!("[{} HOST] {message}\n", utc_timestamp(now()));
        self.lock().append(line.as_bytes());
    }

    /// Record a panic in the file before the default hook prints it.
    ///
    /// A crash is the moment the log is opened, and a panic message goes to stderr rather than
    /// through the logger. `try_lock`, not `lock`: a panic raised while this thread holds the file
    /// would otherwise deadlock the hook, and losing that one message is the better failure.
    pub fn install_panic_hook(&self) {
        let sink = Arc::clone(&self.sink);
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if let Ok(mut sink) = sink.try_lock() {
                let thread = std::thread::current();
                let backtrace = std::backtrace::Backtrace::capture();
                let mut line = format!(
                    "[{} HOST ERROR] thread '{}' {info}\n",
                    utc_timestamp(now()),
                    thread.name().unwrap_or("<unnamed>")
                );
                if backtrace.status() == std::backtrace::BacktraceStatus::Captured {
                    line.push_str(&format!("{backtrace}\n"));
                }
                sink.append(line.as_bytes());
            }
            previous(info);
        }));
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Sink> {
        // A poisoned lock means a panic mid-write; the file is still worth writing to.
        self.sink
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Write for ExecutorLog {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let _ = io::stdout().write_all(buf);
        let mut sink = self.lock();
        let mut escape = sink.escape;
        let stripped = strip_ansi(&mut escape, buf);
        sink.escape = escape;
        sink.append(&stripped);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = io::stdout().flush();
        if let Some(file) = self.lock().file.as_mut() {
            file.flush()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "we-executor-log-{}-{}",
                std::process::id(),
                now().as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn read(dir: &Path, index: usize) -> String {
        fs::read_to_string(dir.join(log_file_name(index))).unwrap()
    }

    #[test]
    fn names_older_runs_with_the_index_before_the_extension() {
        assert_eq!(log_file_name(0), "ad4m.log");
        assert_eq!(log_file_name(3), "ad4m.3.log");
    }

    #[test]
    fn keeps_the_current_run_plus_four() {
        let dir = TempDir::new();
        for run in 1..=7 {
            let mut log = ExecutorLog::open(&dir.0);
            write!(log, "run {run}").unwrap();
        }

        let mut names: Vec<_> = fs::read_dir(&dir.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "ad4m.1.log",
                "ad4m.2.log",
                "ad4m.3.log",
                "ad4m.4.log",
                "ad4m.log"
            ]
        );
        assert_eq!(read(&dir.0, 0), "run 7");
        assert_eq!(read(&dir.0, 4), "run 3");
    }

    #[test]
    fn creates_a_data_directory_that_does_not_exist_yet() {
        let dir = TempDir::new();
        let nested = dir.0.join("we-accounts").join("fresh");
        let mut log = ExecutorLog::open(&nested);
        write!(log, "hello").unwrap();
        assert_eq!(read(&nested, 0), "hello");
    }

    #[test]
    fn strips_colour_codes_split_across_writes() {
        let dir = TempDir::new();
        let mut log = ExecutorLog::open(&dir.0);
        log.write_all(b"a\x1b").unwrap();
        log.write_all(b"[3").unwrap();
        log.write_all("1m— b\x1b[0m".as_bytes()).unwrap();
        assert_eq!(read(&dir.0, 0), "a— b");
    }

    #[test]
    fn stops_at_the_size_limit_and_says_so_once() {
        let dir = TempDir::new();
        let mut log = ExecutorLog::open_with(&dir.0, KEPT_RUNS, 10);
        log.write_all(b"12345").unwrap();
        log.write_all(b"67890").unwrap();
        log.write_all(b"this does not fit").unwrap();
        log.write_all(b"nor this").unwrap();

        let contents = read(&dir.0, 0);
        assert!(contents.starts_with("1234567890\n"));
        assert_eq!(contents.matches("size limit").count(), 1);
        assert!(!contents.contains("fit"));
    }

    #[test]
    fn marks_host_lines() {
        let dir = TempDir::new();
        let log = ExecutorLog::open(&dir.0);
        log.host("AD4M data path: /tmp/x");
        let contents = read(&dir.0, 0);
        assert!(
            contents.ends_with(" HOST] AD4M data path: /tmp/x\n"),
            "{contents}"
        );
    }

    #[test]
    fn formats_utc_timestamps() {
        use std::time::Duration;
        assert_eq!(utc_timestamp(Duration::ZERO), "1970-01-01T00:00:00.000Z");
        // 2024-02-29T23:59:59.999Z — a leap day, to catch the month arithmetic.
        assert_eq!(
            utc_timestamp(Duration::from_millis(1_709_251_199_999)),
            "2024-02-29T23:59:59.999Z"
        );
        assert_eq!(
            utc_timestamp(Duration::from_secs(1_789_466_400)),
            "2026-09-15T10:00:00.000Z"
        );
    }
}
