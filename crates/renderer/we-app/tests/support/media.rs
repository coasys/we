//! The pictures a recorded route paints, from disk rather than the network.
//!
//! The Coasys bundle names its posters, card stills and partner logos by
//! their `https://coasys.org/…` addresses, and the production host fetches
//! them with egui_extras' HTTP loader. A pixel gate that did the same would
//! compare against whatever the site serves today — the film poster was
//! replaced on the morning its baseline was first recorded — and could not
//! run offline at all.
//!
//! [`install`] adds a bytes loader that answers every `http(s)://` address
//! from `fixtures/coasys/media/<host>/<path>`, and fails the test, by name,
//! for one that has no file there. egui asks the most recently added bytes
//! loader first, so it must go in after `we_egui::install_media`.
//!
//! Include it with `#[path = "support/media.rs"] mod media;`.

use std::path::PathBuf;
use std::sync::Arc;

use egui::load::{BytesLoadResult, BytesLoader, BytesPoll};

struct Fixtures {
    root: PathBuf,
}

impl BytesLoader for Fixtures {
    fn id(&self) -> &str {
        "we-app-tests::media-fixtures"
    }

    fn load(&self, _ctx: &egui::Context, uri: &str) -> BytesLoadResult {
        let Some(rest) = uri
            .strip_prefix("https://")
            .or_else(|| uri.strip_prefix("http://"))
        else {
            return Err(egui::load::LoadError::NotSupported);
        };
        let rest = rest.split(['#', '?']).next().unwrap_or(rest);
        let path = self.root.join(rest);
        let bytes = std::fs::read(&path).unwrap_or_else(|e| {
            panic!(
                "{uri}: no fixture at {} ({e}) — the pixel tests do not use the network; \
                 download it there",
                path.display()
            )
        });
        Ok(BytesPoll::Ready {
            size: None,
            bytes: egui::load::Bytes::Shared(Arc::from(bytes)),
            mime: None,
        })
    }

    fn forget(&self, _uri: &str) {}

    fn forget_all(&self) {}

    fn byte_size(&self) -> usize {
        0
    }
}

/// Serve every remote image from `fixtures/coasys/media`. Call after
/// `we_egui::install_media` (or `we_app::init_host`).
pub fn install(ctx: &egui::Context) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/coasys/media");
    ctx.add_bytes_loader(Arc::new(Fixtures { root }));
}
