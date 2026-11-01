//! The main window, and what keeps the app running while it is hidden.
//!
//! - **Navigation.** The window stays on the app's own pages; a frame may load what the policy's
//!   `frame-src` lets it load (`we_custody::window::main_may_navigate`, and
//!   [`navigation_frame_sources`] for where that applies).
//! - **New windows.** The window opens none. A request for one (`window.open`, a link with
//!   `target="_blank"`) opens an `https` address in the OS browser and refuses every other address
//!   (`we_custody::window::opens_in_browser`).
//! - **Close.** Closing the window hides it. The app and its executor keep running, so the computer
//!   keeps syncing. The tray icon's menu shows the window again and quits the app, and starting the
//!   app again shows it (the single-instance plugin, in `lib.rs`). On Linux the window hides only
//!   while a tray host shows the icon; with none, closing the window quits the app, as "Quit" does,
//!   because nothing else on screen could quit it.
//!
//! The window is made here rather than from `tauri.conf.json` (where it is `create: false`), because
//! only a window made in code can have a navigation and a new-window handler.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::NewWindowResponse;
use tauri::{App, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use we_custody::window::{self as rule, MAIN};

const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";

/// Makes the main window from its entry in `tauri.conf.json`, with the rules above.
pub fn create(app: &App) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN)
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    let policy = app
        .config()
        .app
        .security
        .csp
        .as_ref()
        .map(|c| c.to_string());
    let frame_sources = navigation_frame_sources(policy);

    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
        // `tauri::is_dev()`: the dev server is the app's origin under `tauri dev` only.
        .on_navigation(move |url| {
            let allowed = rule::main_may_navigate(url.as_str(), &frame_sources, tauri::is_dev());
            if !allowed {
                log::warn!("main window: refused a navigation to {}", origin_of(url));
            }
            allowed
        })
        .on_new_window(|url, _features| {
            if rule::opens_in_browser(url.as_str()) {
                if let Err(e) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
                    log::warn!(
                        "main window: could not open {} in the browser: {e}",
                        origin_of(&url)
                    );
                }
            } else {
                log::warn!("main window: refused a new window for {}", origin_of(&url));
            }
            NewWindowResponse::Deny
        })
        .build()?;

    let handle = app.handle().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if close_hides(&handle) {
                hide(&handle);
            } else {
                log::info!("main window: closed with no tray icon to reopen it from; quitting");
                handle.exit(0);
            }
        }
    });
    Ok(window)
}

/// The `frame-src` addresses the navigation handler lets through, from the content security policy.
///
/// Linux and macOS ask the handler for each frame as well as for the page, and cannot say which
/// asks, so a frame needs the addresses the policy lets frames load. On Windows the handler is
/// WebView2's `NavigationStarting`, which is for the top-level page only, so there is no carve-out:
/// there the main window can never go to a `frame-src` address. No policy means no frame source.
fn navigation_frame_sources(policy: Option<String>) -> Vec<String> {
    if cfg!(windows) {
        return Vec::new();
    }
    policy
        .map(|csp| rule::csp_sources(&csp, "frame-src"))
        .unwrap_or_default()
}

/// The scheme and host of `url`, for a log line: never the path or the query, which can hold what
/// a person wrote.
fn origin_of(url: &tauri::Url) -> String {
    format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""))
}

/// The tray icon and its menu: "Open <product>" and "Quit <product>".
///
/// macOS: an icon in the menu bar. Linux: a StatusNotifierItem through `libayatana-appindicator`,
/// which shows the menu on a click. With no such library there is no icon, and with no tray host
/// (GNOME without an AppIndicator extension) the icon is not shown; either way closing the window
/// quits the app ([`close_hides`]).
pub fn create_tray(app: &App) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        if !linux_tray::library_loads() {
            log::warn!(
                "tray: no libayatana-appindicator3 or libappindicator3, so no tray icon; \
                 closing the window quits the app"
            );
            return Ok(());
        }
        if !linux_tray::host_present() {
            log::warn!(
                "tray: no tray host (org.kde.StatusNotifierWatcher) now, so no tray icon shows; \
                 closing the window quits the app while there is none"
            );
        }
    }
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "WE".into());
    let open = MenuItem::with_id(
        app,
        MENU_OPEN,
        format!("Open {product}"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        MENU_QUIT,
        format!("Quit {product}"),
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id(MAIN)
        .tooltip(&product)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => show(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayIcon);
    Ok(())
}

/// Managed once the tray icon exists.
struct TrayIcon;

/// Whether closing the main window hides it, rather than quitting the app: only while a tray icon
/// can show it again. On Linux that also needs a tray host now, which can come and go.
fn close_hides<R: Runtime>(app: &AppHandle<R>) -> bool {
    let built = app.try_state::<TrayIcon>().is_some();
    #[cfg(target_os = "linux")]
    return built && linux_tray::host_present();
    #[cfg(not(target_os = "linux"))]
    built
}

/// What a Linux tray icon needs at run time.
#[cfg(target_os = "linux")]
mod linux_tray {
    use webkit2gtk::{gio, glib, glib::ToVariant};

    /// The names `libappindicator-sys` loads the library by, in its order (with its default
    /// `backcompat` feature, which `tray-icon` keeps). It panics when none of them loads.
    const LIBRARIES: &[&str] = &[
        "libayatana-appindicator3.so.1",
        "libappindicator3.so.1",
        "libayatana-appindicator3.so",
        "libappindicator3.so",
    ];

    /// Whether one of [`LIBRARIES`] loads, so that building the tray icon cannot panic.
    pub fn library_loads() -> bool {
        // SAFETY: these are the libraries `libappindicator-sys` loads in any case, when the tray
        // icon is built; their initialisers run then whether or not they run here first.
        LIBRARIES
            .iter()
            .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
    }

    /// Whether a tray host is there to show the icon: a process owns
    /// `org.kde.StatusNotifierWatcher` on the session bus. No session bus means no tray host.
    pub fn host_present() -> bool {
        let Ok(bus) = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>) else {
            return false;
        };
        bus.call_sync(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "NameHasOwner",
            Some(&("org.kde.StatusNotifierWatcher",).to_variant()),
            glib::VariantTy::new("(b)").ok(),
            gio::DBusCallFlags::NONE,
            1000,
            None::<&gio::Cancellable>,
        )
        .ok()
        .and_then(|reply| reply.get::<(bool,)>())
        .is_some_and(|(owned,)| owned)
    }
}

/// Shows and focuses the main window. On macOS the app comes back to the Dock and the app switcher.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hides the main window. On macOS the app leaves the Dock and the app switcher while it is hidden,
/// unless another of its windows is visible; its icon in the menu bar stays.
fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    leave_dock_if_unseen(app, MAIN);
}

/// macOS: takes the app out of the Dock and the app switcher when none of its windows is visible.
/// `going` is a window that is being hidden or closed, which counts as not visible. The identity
/// window calls this when it closes, so the app leaves the Dock then if the main window is hidden.
#[cfg(target_os = "macos")]
pub fn leave_dock_if_unseen<R: Runtime>(app: &AppHandle<R>, going: &str) {
    let windows = app.webview_windows();
    let seen = windows
        .iter()
        .map(|(label, window)| (label.as_str(), window.is_visible().unwrap_or(false)));
    if may_leave_dock(seen, going) {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

/// Whether the app may leave the Dock: no window but `going` is visible. `windows` is each window's
/// label and whether it is visible.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn may_leave_dock<'a>(windows: impl IntoIterator<Item = (&'a str, bool)>, going: &str) -> bool {
    windows
        .into_iter()
        .all(|(label, visible)| !visible || label == going)
}

#[cfg(test)]
mod tests {
    use super::{may_leave_dock, navigation_frame_sources};
    use we_custody::window::{IDENTITY, MAIN};

    #[test]
    fn the_app_stays_in_the_dock_while_another_window_is_visible() {
        // The main window is hidden mid-step: the identity window keeps the app in the Dock.
        assert!(!may_leave_dock([(MAIN, false), (IDENTITY, true)], MAIN));
        // Hidden before `is_visible` says so: the window going does not count.
        assert!(may_leave_dock([(MAIN, true)], MAIN));
        assert!(may_leave_dock([(MAIN, false), (IDENTITY, false)], MAIN));
        // The identity window closes: the app leaves only if the main window is hidden.
        assert!(may_leave_dock([(MAIN, false), (IDENTITY, true)], IDENTITY));
        assert!(!may_leave_dock([(MAIN, true), (IDENTITY, true)], IDENTITY));
    }

    #[test]
    fn only_a_webview_that_asks_for_frames_gets_the_frame_carve_out() {
        let policy = Some("default-src 'self'; frame-src 'self' https://www.youtube.com".into());
        let sources = navigation_frame_sources(policy);
        if cfg!(windows) {
            // WebView2 asks for the top-level page only: no frame-src address for the window.
            assert!(sources.is_empty());
        } else {
            assert_eq!(sources, ["'self'", "https://www.youtube.com"]);
        }
        assert!(navigation_frame_sources(None).is_empty());
    }
}
