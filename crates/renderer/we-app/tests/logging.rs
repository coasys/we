//! B2: the app installs a logger, so `log::warn!` (the adapter's, the
//! layout's) reaches stderr instead of being dropped. `RUST_LOG` overrides
//! the level, per target.
use std::io::Write;
use std::sync::{Arc, Mutex};

use log::{Level, LevelFilter, Log, Record};
use we_app::logging::{Filter, Logger};

#[derive(Clone, Default)]
struct Sink(Arc<Mutex<Vec<u8>>>);

impl Write for Sink {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn say(logger: &Logger, level: Level, target: &str, msg: &str) {
    logger.log(
        &Record::builder()
            .level(level)
            .target(target)
            .args(format_args!("{msg}"))
            .build(),
    );
}

#[test]
fn warnings_show_by_default_and_info_does_not() {
    let sink = Sink::default();
    let logger = Logger::new(Filter::parse(""), Box::new(sink.clone()));
    say(&logger, Level::Warn, "we_ad4m::source", "query failed");
    say(&logger, Level::Info, "we_ad4m::source", "chatter");
    let out = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
    assert_eq!(out, "WARN we_ad4m::source: query failed\n");
}

#[test]
fn rust_log_sets_the_default_and_per_target_levels() {
    let f = Filter::parse("error,we_ad4m=debug,we_layout::tree=off");
    assert!(f.allows("we_ad4m::source", Level::Debug));
    assert!(!f.allows("we_ad4m::source", Level::Trace));
    assert!(!f.allows("we_egui", Level::Warn), "the default is error");
    assert!(f.allows("we_egui", Level::Error));
    assert!(!f.allows("we_layout::tree", Level::Error), "off is off");
    assert_eq!(f.max_level(), LevelFilter::Debug);
}

#[test]
fn the_longest_matching_target_wins_and_a_prefix_stops_at_a_path_edge() {
    let f = Filter::parse("warn,we=error,we_ad4m=trace");
    assert!(f.allows("we_ad4m::source", Level::Trace));
    assert!(
        f.allows("we_adx", Level::Warn),
        "`we` is not a prefix of we_adx"
    );
    assert!(!f.allows("we::x", Level::Warn), "but it is of we::x");
    assert!(f.allows("wgpu", Level::Warn));
}

#[test]
fn a_bare_target_means_everything_from_it_and_junk_is_ignored() {
    let f = Filter::parse("we_ad4m, nonsense=loud ,info");
    assert!(f.allows("we_ad4m", Level::Trace));
    assert!(f.allows("other", Level::Info));
    assert!(!f.allows("other", Level::Debug));
}

#[test]
fn only_targets_keep_warnings_visible_elsewhere() {
    // `RUST_LOG=we_ad4m=debug` must not silence the rest of the app's warnings.
    let f = Filter::parse("we_ad4m=debug");
    assert!(f.allows("we_layout", Level::Warn));
}
