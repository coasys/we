//! The folders the app's identifier names, and the one move a new identifier needs.
//!
//! On Linux the webview keeps its data — local storage, IndexedDB, cookies and its cache — in
//! `$XDG_DATA_HOME/<identifier>`. That is the only folder the identifier names. When a seed gives the
//! Tauri app a new identifier (`desktop.tauriId`; the Coasys app's is `org.coasys.app`), the app
//! moves that folder from the identifier it had before, once, before it makes a window: else the
//! webview starts empty and a person's local settings are gone.
//!
//! Nothing else moves, because nothing else is named by the identifier:
//!
//! - the executor's data is where `ad4m.dataPath` or the account registry says;
//! - the custody service keeps its sealed files and `pending-incepts.json` in
//!   `<data dir>/coasys/custody` ([`custody_dir`]), and names its keychain items by the service
//!   `org.coasys.app` (macOS) or the attribute `coasys-identity` (Secret Service), both constants of
//!   `we-custody`. A master key kept before the move is where it was after it.
//!
//! On macOS the webview's data is in a folder WebKit names by the bundle identifier, which the app
//! does not move: no macOS build of the Tauri app was released under the former identifier.

use std::io;
use std::path::{Path, PathBuf};

/// Where the custody service keeps its files: `<data dir>/coasys/custody`. Named by a constant, not
/// by the app's identifier, so a new identifier cannot move a person's master key.
pub fn custody_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("coasys").join("custody")
}

/// What [`move_webview_data`] did.
#[derive(Debug)]
pub enum Move {
    /// There was nothing to move: no former identifier, or no folder under it.
    Nothing,
    /// The former folder is now the folder of the identifier.
    Done { from: PathBuf, to: PathBuf },
    /// Both folders exist, so the app has run under the new identifier already. Neither is changed.
    BothExist { former: PathBuf },
    /// The move failed; the former folder is unchanged and the webview starts with no data.
    Failed { from: PathBuf, error: io::Error },
}

/// Moves `<base>/<former>` to `<base>/<identifier>` when the first exists and the second does not.
/// `base` is the folder the webview's data folder is in (`$XDG_DATA_HOME` on Linux).
///
/// A rename, so the move is complete or not done at all; it never merges two folders, and it never
/// deletes one.
pub fn move_webview_data(base: &Path, former: Option<&str>, identifier: &str) -> Move {
    let Some(former) = former.filter(|f| *f != identifier && !f.is_empty()) else {
        return Move::Nothing;
    };
    let (from, to) = (base.join(former), base.join(identifier));
    if !from.is_dir() {
        return Move::Nothing;
    }
    if to.exists() {
        return Move::BothExist { former: from };
    }
    match std::fs::rename(&from, &to) {
        Ok(()) => Move::Done { from, to },
        Err(error) => Move::Failed { from, error },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the system's temporary folder, removed when dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("we-data-folder-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    const FORMER: &str = "io.coasys.app.tauri";
    const NEW: &str = "org.coasys.app";

    #[test]
    fn the_webview_data_moves_to_the_new_identifier_and_the_master_key_stays() {
        let base = Scratch::new();
        let storage = Path::new("localstorage/tauri_localhost_0.localstorage");
        write(&base.0.join(FORMER).join(storage), b"settings");
        // What the custody service holds: a sealed master key and an incept not yet published.
        let custody = custody_dir(&base.0);
        let key = custody.join("did-scid-example.bin");
        let pending = custody.join("pending-incepts.json");
        write(&key, b"sealed master key");
        write(&pending, b"[]");

        let moved = move_webview_data(&base.0, Some(FORMER), NEW);

        assert!(matches!(moved, Move::Done { .. }), "{moved:?}");
        assert!(!base.0.join(FORMER).exists());
        assert_eq!(
            std::fs::read(base.0.join(NEW).join(storage)).unwrap(),
            b"settings"
        );
        assert_eq!(std::fs::read(&key).unwrap(), b"sealed master key");
        assert_eq!(std::fs::read(&pending).unwrap(), b"[]");
        // A second start finds nothing more to do.
        assert!(matches!(
            move_webview_data(&base.0, Some(FORMER), NEW),
            Move::Nothing
        ));
    }

    #[test]
    fn the_custody_folder_is_named_by_no_identifier() {
        let base = Path::new("/data");
        assert_eq!(custody_dir(base), Path::new("/data/coasys/custody"));
        for identifier in [FORMER, NEW, "io.weco.we.tauri"] {
            assert!(!custody_dir(base).starts_with(base.join(identifier)));
        }
    }

    #[test]
    fn a_folder_already_made_under_the_new_identifier_is_kept_and_nothing_merges() {
        let base = Scratch::new();
        write(&base.0.join(FORMER).join("a"), b"old");
        write(&base.0.join(NEW).join("a"), b"new");

        let moved = move_webview_data(&base.0, Some(FORMER), NEW);

        assert!(matches!(moved, Move::BothExist { .. }), "{moved:?}");
        assert_eq!(
            std::fs::read(base.0.join(FORMER).join("a")).unwrap(),
            b"old"
        );
        assert_eq!(std::fs::read(base.0.join(NEW).join("a")).unwrap(), b"new");
    }

    #[test]
    fn no_former_identifier_or_no_former_folder_moves_nothing() {
        let base = Scratch::new();
        assert!(matches!(
            move_webview_data(&base.0, None, NEW),
            Move::Nothing
        ));
        assert!(matches!(
            move_webview_data(&base.0, Some(NEW), NEW),
            Move::Nothing
        ));
        assert!(matches!(
            move_webview_data(&base.0, Some(FORMER), NEW),
            Move::Nothing
        ));
        assert!(!base.0.join(NEW).exists());
    }

    #[test]
    fn a_failed_move_leaves_the_former_folder_as_it_was() {
        let base = Scratch::new();
        write(&base.0.join(FORMER).join("a"), b"old");
        // The new folder's parent does not exist, so the rename fails.
        let moved = move_webview_data(&base.0, Some(FORMER), "missing/org.coasys.app");

        assert!(matches!(moved, Move::Failed { .. }), "{moved:?}");
        assert_eq!(
            std::fs::read(base.0.join(FORMER).join("a")).unwrap(),
            b"old"
        );
    }
}
