//! The context switches a pixel gate turns on and production never does.
//!
//! Baselines are recorded on one machine and checked on CI, under another
//! lavapipe. Mesa 25 divides a blend by 255 a level low for some products
//! that mesa 26 rounds exactly; a gradient whose alpha is a multiple of 3
//! never forms one of those products, so with
//! [`we_egui::set_gradient_alpha_steps`] on, a translucent wash blends to
//! the same byte on both (`NOTES-glow.md`, "CI pixel_about"). The app
//! itself keeps every alpha level: the Glow washes are low alpha, and
//! stepping them costs levels a dark surface would show as banding.
//!
//! Include it with `#[path = "support/gate.rs"] mod gate;` and call
//! [`setup`] from the context setup of every harness that compares pixels
//! against a checked-in baseline.

/// Every switch a snapshot harness needs on its context.
pub fn setup(ctx: &egui::Context) {
    we_egui::set_gradient_alpha_steps(ctx, true);
}
