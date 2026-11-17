//! The app's logger. Nothing installed one, so every `log::warn!` in the
//! crates below (the adapter's failed-query line, the layout's) was dropped.
//! This one writes `LEVEL target: message` lines to stderr.
//!
//! The level is `warn` unless `RUST_LOG` says otherwise. `RUST_LOG` is a
//! comma list of directives, as `env_logger` reads it: a bare level
//! (`debug`) sets the default, `target=level` sets one target and everything
//! under it (`we_ad4m=trace`), and a bare target (`we_ad4m`) means every
//! level from it. The longest matching target wins. A spec naming only
//! targets leaves the default at `warn`, so asking for one crate's debug
//! output does not silence everyone else's warnings.
//!
//! A hand-written logger rather than `env_logger`: this is the one thing it
//! would be used for, and it is not in the dependency tree yet.

use std::io::Write;
use std::sync::Mutex;

use log::{Level, LevelFilter, Log, Metadata, Record};

/// What `RUST_LOG` allows.
#[derive(Clone, Debug)]
pub struct Filter {
    default: LevelFilter,
    targets: Vec<(String, LevelFilter)>,
}

impl Filter {
    /// Parse a `RUST_LOG` value; an empty or unreadable one is `warn`.
    pub fn parse(spec: &str) -> Filter {
        let mut default = None;
        let mut targets = Vec::new();
        for directive in spec.split(',').map(str::trim).filter(|d| !d.is_empty()) {
            match directive.split_once('=') {
                Some((target, level)) => {
                    if let Ok(level) = level.trim().parse::<LevelFilter>() {
                        targets.push((target.trim().to_string(), level));
                    }
                }
                None => match directive.parse::<LevelFilter>() {
                    Ok(level) => default = Some(level),
                    Err(_) => targets.push((directive.to_string(), LevelFilter::Trace)),
                },
            }
        }
        Filter {
            default: default.unwrap_or(LevelFilter::Warn),
            targets,
        }
    }

    /// `RUST_LOG`, or `warn` when it is unset.
    pub fn from_env() -> Filter {
        Filter::parse(&std::env::var("RUST_LOG").unwrap_or_default())
    }

    fn level_for(&self, target: &str) -> LevelFilter {
        self.targets
            .iter()
            .filter(|(t, _)| {
                target == t
                    || target
                        .strip_prefix(t.as_str())
                        .is_some_and(|rest| rest.starts_with("::"))
            })
            .max_by_key(|(t, _)| t.len())
            .map_or(self.default, |(_, level)| *level)
    }

    pub fn allows(&self, target: &str, level: Level) -> bool {
        level <= self.level_for(target)
    }

    /// The most verbose level any directive allows: what `log::set_max_level`
    /// takes, so a disabled level costs nothing at the call site.
    pub fn max_level(&self) -> LevelFilter {
        self.targets
            .iter()
            .map(|(_, l)| *l)
            .chain([self.default])
            .max()
            .unwrap_or(LevelFilter::Off)
    }
}

/// A [`Log`] writing to a sink — stderr in the app.
pub struct Logger {
    filter: Filter,
    sink: Mutex<Box<dyn Write + Send>>,
}

impl Logger {
    pub fn new(filter: Filter, sink: Box<dyn Write + Send>) -> Logger {
        Logger {
            filter,
            sink: Mutex::new(sink),
        }
    }
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        self.filter.allows(metadata.target(), metadata.level())
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        if let Ok(mut sink) = self.sink.lock() {
            let _ = writeln!(
                sink,
                "{} {}: {}",
                record.level(),
                record.target(),
                record.args()
            );
        }
    }

    fn flush(&self) {
        if let Ok(mut sink) = self.sink.lock() {
            let _ = sink.flush();
        }
    }
}

/// Install the stderr logger, from `RUST_LOG`. A second call, or a logger
/// already installed by the host, leaves the first one in place.
pub fn init() {
    let filter = Filter::from_env();
    let max = filter.max_level();
    let logger = Logger::new(filter, Box::new(std::io::stderr()));
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(max);
    }
}
