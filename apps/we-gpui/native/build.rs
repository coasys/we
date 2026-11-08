//! Link against `libxkbcommon-x11` on a machine that has the library but not its `-dev` package.
//!
//! GPUI's X11 backend links `-lxkbcommon-x11`, which the linker resolves through the unversioned
//! `libxkbcommon-x11.so` symlink that only `libxkbcommon-x11-dev` installs. The runtime library
//! (`.so.0`) is present on any desktop with X11 input, so when the symlink is missing this points
//! the linker at one made in `OUT_DIR`. With the dev package installed, nothing happens.
fn main() {
    #[cfg(target_os = "linux")]
    link_xkbcommon_x11();
}

#[cfg(target_os = "linux")]
fn link_xkbcommon_x11() {
    use std::path::{Path, PathBuf};

    const DIRS: [&str; 3] = ["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"];
    if DIRS
        .iter()
        .any(|dir| Path::new(dir).join("libxkbcommon-x11.so").exists())
    {
        return;
    }
    let Some(runtime) = DIRS
        .iter()
        .map(|dir| Path::new(dir).join("libxkbcommon-x11.so.0"))
        .find(|path| path.exists())
    else {
        println!("cargo:warning=libxkbcommon-x11 is not installed; the X11 backend will not link");
        return;
    };
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
    let link = out.join("libxkbcommon-x11.so");
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(&runtime, &link).expect("symlink libxkbcommon-x11.so in OUT_DIR");
    println!("cargo:rustc-link-search=native={}", out.display());
}
