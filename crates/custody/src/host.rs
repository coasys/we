//! What every desktop host starts the custody service with: the folder its keys live in. The Tauri
//! app and the sidecar (`sidecar`) both read it here, so the two shells keep the same keys in the
//! same place.
//!
//! Nothing here says which identity store the executor uses or whether it trusts one: custody asks
//! the executor (`identity.status`), and a host only passes `AD4M_IDENTITY_STORE_URL` and
//! `AD4M_IDENTITY_STORE_KEYS` on to the executor it starts.

use std::path::{Path, PathBuf};

/// `<data dir>/coasys/custody`, shared by every account and every desktop app on this computer:
/// `$XDG_DATA_HOME` (or `~/.local/share`) on Linux, `~/Library/Application Support` on macOS.
pub fn custody_dir(home: &Path) -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| home.join(".local/share"))
        .join("coasys")
        .join("custody")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_custody_folder_is_coasys_custody_in_the_data_dir() {
        let dir = custody_dir(Path::new("/home/someone"));
        assert!(dir.ends_with("coasys/custody"));
    }
}
