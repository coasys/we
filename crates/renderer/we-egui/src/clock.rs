//! The wall clock a date-reading widget paints from. `we-timestamp`'s
//! `relative` and `we-date-picker`'s "today" ask [`now_secs`]; the answer
//! is the real `SystemTime` unless a host pinned it. A pixel gate pins it
//! per `egui::Context` with [`pin_now`] so a checked-in oracle does not
//! drift with the day the test runs on.
//!
//! `PaintCx.now` is something else — the frame clock (seconds since the
//! app started) animations read. Nothing here touches it.

/// "Now" as epoch seconds — the instant [`pin_now`] stashed on this ctx,
/// or the wall clock when nothing is pinned.
pub fn now_secs(ctx: &egui::Context) -> f64 {
    ctx.data_mut(|d| d.get_persisted::<f64>(egui::Id::unique(NOW_KEY)))
        .unwrap_or_else(wall_now)
}

/// Pin "now" for every [`now_secs`] reader on this ctx — `None` restores
/// the wall clock. Persisted data: the pin holds across frames until
/// unpinned (unlike the temp stash `defaults` rewrites each frame).
pub fn pin_now(ctx: &egui::Context, secs: Option<f64>) {
    ctx.data_mut(|d| {
        let key = egui::Id::unique(NOW_KEY);
        match secs {
            Some(s) => d.insert_persisted(key, s),
            None => d.remove::<f64>(key),
        }
    });
}

const NOW_KEY: &str = "we-egui::now";

/// The fallback — the OS wall clock as epoch seconds.
fn wall_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
