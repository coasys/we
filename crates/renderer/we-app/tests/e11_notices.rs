//! E11: what a connected window draws when a write goes wrong, and the
//! confirmation the host asks before a delete — drawn on their own, no
//! executor.
#[path = "support/gpu.rs"]
mod gpu;

use egui::Vec2;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use we_ad4m::Notices;
use we_app::connected::{draw_confirm, draw_notices};
use we_data::writes::Confirm;

#[test]
fn a_notice_shows_the_executors_message_until_dismissed() {
    let notices = Notices::default();
    notices.push("Could not save that change. Validation failed for class 'X'".into());
    let theme = we_app::gallery::load_theme_set().theme("dark").0.clone();
    let shown = notices.clone();
    let mut h = Harness::builder()
        .renderer(gpu::serial())
        .with_size(Vec2::new(480.0, 200.0))
        .build_ui(move |ui| draw_notices(ui, &shown, &theme));
    h.run();
    h.get_by_label_contains("Validation failed");
    h.get_by_label("Dismiss").click();
    h.run();
    assert!(notices.list().is_empty());
    assert!(h.query_by_label_contains("Validation failed").is_none());
}

fn confirm_answer(button: &str) -> Option<bool> {
    let confirm = Confirm {
        title: "Delete this TaskBlock?".into(),
        body: "It will be removed for everyone in this space. This cannot be undone.".into(),
    };
    let mut h = Harness::builder()
        .renderer(gpu::serial())
        .with_size(Vec2::new(640.0, 400.0))
        .build_ui_state(
            move |ui, answer: &mut Option<bool>| {
                if let Some(a) = draw_confirm(ui, &confirm) {
                    answer.get_or_insert(a);
                }
            },
            None,
        );
    h.run();
    h.get_by_label_contains("Delete this TaskBlock?");
    assert_eq!(*h.state(), None, "nothing answered yet");
    h.get_by_label(button).click();
    h.run();
    *h.state()
}

#[test]
fn confirm_modal_answers() {
    assert_eq!(confirm_answer("Delete"), Some(true));
    assert_eq!(confirm_answer("Cancel"), Some(false));
}
