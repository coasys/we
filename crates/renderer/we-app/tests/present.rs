//! The window's surface: vsynced with at most one frame queued unless the
//! measuring variables say otherwise.
use eframe::wgpu::PresentMode;
use we_app::surface_config;

#[test]
fn by_default_one_frame_is_queued_and_frames_wait_for_vsync() {
    let s = surface_config(None, None);
    assert_eq!(s.present_mode, PresentMode::AutoVsync, "no tearing");
    let expected = if cfg!(target_os = "ios") {
        None
    } else {
        Some(1)
    };
    assert_eq!(s.desired_maximum_frame_latency, expected);
}

#[test]
fn the_variables_set_the_depth_and_the_mode() {
    let s = surface_config(Some("2"), Some("mailbox"));
    assert_eq!(s.desired_maximum_frame_latency, Some(2));
    assert_eq!(s.present_mode, PresentMode::Mailbox);
    assert_eq!(
        surface_config(Some("0"), None).desired_maximum_frame_latency,
        Some(1)
    );
    assert_eq!(
        surface_config(Some("many"), None),
        surface_config(None, None),
        "a depth that is not a number is ignored"
    );
}

/// Every window the binary opens takes its options from
/// `we_app::window_options`, so none is opened without the surface above:
/// the binary builds no `NativeOptions` of its own.
#[test]
fn every_window_takes_the_surface_config() {
    let main = include_str!("../src/main.rs");
    let built: Vec<_> = main
        .lines()
        .enumerate()
        .filter(|(_, l)| l.contains("NativeOptions {"))
        .map(|(n, l)| format!("main.rs:{}: {}", n + 1, l.trim()))
        .collect();
    assert!(
        built.is_empty(),
        "windows built without window_options: {built:?}"
    );
}

/// What `window_options` builds carries the surface `wgpu_options` chose.
#[test]
fn window_options_carry_the_surface() {
    let options = we_app::window_options("t", [100.0, 100.0]);
    assert_eq!(options.wgpu_options.surface, we_app::wgpu_options().surface);
}
