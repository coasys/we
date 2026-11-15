//! One GPU at a time for the tests of a binary.
//!
//! Each `Harness` brings up its own wgpu device on first `render()` and
//! drops it with the harness, and libtest runs a binary's tests on
//! parallel threads. On CI that GPU is lavapipe (CPU Vulkan), and the test
//! binary doing the most of that at once — `font_raster`, sixteen devices
//! made and dropped across three threads — died with SIGSEGV in two of
//! four runs, before any of its rendering tests reported. Nothing about it
//! reproduced on a developer machine; see `NOTES-unflake.md` at the
//! repository root.
//!
//! [`serial`] is the renderer such a harness takes instead: egui_kittest's
//! own lazy wgpu renderer, with the same defaults, so every image is what
//! it was — but its texture uploads, its render and dropping its device
//! each hold one lock shared by the whole binary. Layout, painting and
//! assertions stay parallel; only the GPU work queues.
//!
//! Include it with `#[path = "support/gpu.rs"] mod gpu;` and build every
//! harness that renders with `.renderer(gpu::serial())`.

use std::sync::{Mutex, MutexGuard, PoisonError};

use egui::TexturesDelta;
use egui_kittest::{LazyRenderer, TestRenderer};

static GPU: Mutex<()> = Mutex::new(());

/// A test that panicked mid-render leaves the lock poisoned; the device it
/// held is gone either way, so the next test may go ahead.
fn gpu() -> MutexGuard<'static, ()> {
    GPU.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The default wgpu renderer, made, used and dropped under the lock.
pub fn serial() -> SerialGpu {
    SerialGpu(Some(LazyRenderer::default()))
}

pub struct SerialGpu(Option<LazyRenderer>);

impl TestRenderer for SerialGpu {
    fn handle_delta(&mut self, delta: &mut TexturesDelta) {
        let _gpu = gpu();
        if let Some(inner) = &mut self.0 {
            inner.handle_delta(delta);
        }
    }

    fn render(
        &mut self,
        ctx: &egui::Context,
        output: &egui::FullOutput,
    ) -> Result<image::RgbaImage, String> {
        let _gpu = gpu();
        match &mut self.0 {
            Some(inner) => inner.render(ctx, output),
            None => Err("renderer already dropped".to_owned()),
        }
    }
}

impl Drop for SerialGpu {
    fn drop(&mut self) {
        let _gpu = gpu();
        self.0.take();
    }
}
