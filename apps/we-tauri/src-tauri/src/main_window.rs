//! The main window, and what keeps the app running while it is hidden.
//!
//! - **Navigation.** The window stays on the app's own pages; a frame may load what the policy's
//!   `frame-src` lets it load (`we_custody::window::main_may_navigate`).
//! - **New windows.** The window opens none. A request for one (`window.open`, a link with
//!   `target="_blank"`) opens an `https` address in the OS browser and refuses every other address
//!   (`we_custody::window::opens_in_browser`).
//! - **Close.** Closing the window hides it. The app and its executor keep running, so the computer
//!   keeps syncing. The tray icon's menu shows the window again and quits the app, and starting the
//!   app again shows it (the single-instance plugin, in `lib.rs`).
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
    // The frames the policy lets the page load: the webview asks the navigation handler for each
    // frame too. No policy means no frame source, so only the app's own pages load.
    let frame_sources = app
        .config()
        .app
        .security
        .csp
        .as_ref()
        .map(|csp| rule::csp_sources(&csp.to_string(), "frame-src"))
        .unwrap_or_default();

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
            hide(&handle);
        }
    });
    Ok(window)
}

/// The scheme and host of `url`, for a log line: never the path or the query, which can hold what
/// a person wrote.
fn origin_of(url: &tauri::Url) -> String {
    format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""))
}

/// The tray icon and its menu: "Open <product>" and "Quit <product>".
///
/// macOS: an icon in the menu bar. Linux: a StatusNotifierItem through `libayatana-appindicator`,
/// which shows the menu on a click; a desktop with no tray (GNOME without an AppIndicator extension)
/// shows no icon, and starting the app again from the launcher shows the window.
pub fn create_tray(app: &App) -> tauri::Result<()> {
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
    Ok(())
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

/// Hides the main window. On macOS the app leaves the Dock and the app switcher while it is hidden;
/// its icon in the menu bar stays.
fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}
