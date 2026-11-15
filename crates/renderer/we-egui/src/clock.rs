//! The wall clock a date-reading widget paints from. `we-timestamp`'s
//! `relative` and `we-date-picker`'s "today" ask [`now_secs`]; the answer
//! is the real `SystemTime` unless a host pinned it. A pixel gate pins it
//! per `egui::Context` with [`pin_now`] so a checked-in oracle does not
//! drift with the day the test runs on.
//!
//! The pin is *temp* ctx data: held for the ctx's life (nothing clears it
//! between frames), but never written into eframe's persisted storage —
//! a saved pin would freeze "now" across an app restart.
//!
//! `PaintCx.now` is something else — the frame clock (seconds since the
//! app started) animations read. Nothing here touches it.

/// "Now" as epoch seconds — the instant [`pin_now`] stashed on this ctx,
/// or the wall clock when nothing is pinned.
pub fn now_secs(ctx: &egui::Context) -> f64 {
    ctx.data(|d| d.get_temp::<f64>(egui::Id::unique(NOW_KEY)))
        .unwrap_or_else(wall_now)
}

/// Pin "now" for every [`now_secs`] reader on this ctx — `None` restores
/// the wall clock. Temp data (`insert_temp`): the pin holds across frames
/// until unpinned, but is not part of the persisted set eframe writes to
/// storage — under `persistence` an `insert_persisted` pin would be saved
/// and survive a restart (Lal P3).
pub fn pin_now(ctx: &egui::Context, secs: Option<f64>) {
    ctx.data_mut(|d| {
        let key = egui::Id::unique(NOW_KEY);
        match secs {
            Some(s) => {
                d.insert_temp(key, s);
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    const PIN: f64 = 1_759_795_200.0; // 2025-10-07T00:00:00Z

    /// The pin must stay out of the persisted set: a serde round trip of
    /// the ctx data — the same bytes eframe's `persistence` writes to
    /// storage and reads back — must drop it (Lal P3).
    #[test]
    fn pin_is_dropped_by_a_persistence_round_trip() {
        let ctx = egui::Context::default();
        pin_now(&ctx, Some(PIN));
        assert_eq!(now_secs(&ctx), PIN);

        let persisted = ctx.data(|d| serde_json::to_value(d).unwrap());
        assert_eq!(persisted, serde_json::json!([]));

        let mut restored: egui::util::IdTypeMap =
            serde_json::from_value(persisted).expect("persisted data deserializes");
        assert_eq!(
            restored.get_persisted::<f64>(egui::Id::unique(NOW_KEY)),
            None
        );
    }

    /// Temp data still holds across frames — the pin outlives the frame
    /// that set it, and `None` restores the wall clock.
    #[test]
    fn pin_holds_across_frames_until_unpinned() {
        let ctx = egui::Context::default();
        pin_now(&ctx, Some(PIN));
        for _ in 0..3 {
            let mut output = ctx.run_pass(egui::RawInput::default(), |ctx| {
                assert_eq!(now_secs(ctx), PIN);
            });
            output.textures_delta.clear();
        }
        assert_eq!(now_secs(&ctx), PIN);

        pin_now(&ctx, None);
        assert_ne!(now_secs(&ctx), PIN);
    }
}
