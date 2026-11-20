//! The shell's state and its two webview windows: the app (`main`) and the identity window.
//!
//! One [`Shell`] global holds what lives as long as the process — the port and admin credential,
//! the executor supervisor, the custody service — and which windows are open. Each webview window
//! gets its own scheme, its own nonce and its own label; a message from it is checked against the
//! label it came from before any command runs (`commands::dispatch`).

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;

use futures::StreamExt;
use futures::channel::mpsc;
use gpui_kit::*;
use gpui_webview::WebView;
use serde_json::Value;
use we_custody::{CustodyHandle, IdentityStep, StepOutcome};

use crate::accounts::AccountRegistry;
use crate::executor::{Launch, Supervisor};
use crate::navigation::{self, Decision};
use crate::{assets, bridge, commands, config};

/// The identity step in progress, and the window running it.
#[derive(Default)]
pub struct IdentitySlot {
    pub step: Option<IdentityStep>,
    pub outcome: Option<StepOutcome>,
    pub window: Option<AnyWindowHandle>,
}

/// The app window and its webview, once open.
pub struct MainRefs {
    pub window: AnyWindowHandle,
    pub webview: WeakEntity<WebView>,
    pub url: String,
}

#[derive(Clone)]
pub struct Shell {
    pub runtime: tokio::runtime::Handle,
    pub supervisor: Supervisor,
    pub custody: CustodyHandle,
    pub port: u16,
    pub credential: Arc<str>,
    pub dist: PathBuf,
    pub dev_url: Option<String>,
    pub binary: PathBuf,
    pub data_path_env: Option<String>,
    /// False on native Wayland, where no webview can be a child of a GPUI window.
    pub webviews_supported: bool,
    pub identity: Rc<RefCell<IdentitySlot>>,
    pub main: Rc<RefCell<Option<MainRefs>>>,
    pub launcher: Rc<RefCell<Option<AnyWindowHandle>>>,
}

impl Global for Shell {}

impl Shell {
    pub fn registry(&self) -> AccountRegistry {
        config::registry()
    }

    /// What the next start of the executor is given: the account and settings as they are now.
    pub fn launch(&self) -> Launch {
        let registry = self.registry();
        let data_path =
            config::resolve_data_path(self.data_path_env.clone(), &registry, &config::home_dir());
        Launch {
            binary: self.binary.clone(),
            data_path,
            port: self.port,
            credential: self.credential.to_string(),
            settings: registry.executor_settings(),
            identity_store_url: config::identity_store_setting(
                std::env::var("AD4M_IDENTITY_STORE_URL").ok(),
            ),
            identity_store_keys: config::identity_store_setting(
                std::env::var("AD4M_IDENTITY_STORE_KEYS").ok(),
            ),
        }
    }
}

/// One webview window's surface: what it is called, what it may load, how it is reached.
pub struct Surface {
    pub label: &'static str,
    pub scheme: &'static str,
    pub root: PathBuf,
    /// A dev server URL to load instead of the bundle (the app window only).
    pub dev_url: Option<String>,
}

impl Surface {
    pub fn origin(&self) -> String {
        match &self.dev_url {
            Some(url) => navigation::origin_of(url).unwrap_or_default(),
            None => assets::origin(self.scheme),
        }
    }

    pub fn start_url(&self) -> String {
        self.dev_url
            .clone()
            .unwrap_or_else(|| assets::start_url(self.scheme))
    }
}

/// What a webview hands to the foreground: a message for a command, or a link for the browser.
enum Inbound {
    Ipc(String),
    OpenExternally(String),
}


/// Builds `surface`'s webview in `window` and starts the task that answers it.
pub fn build_webview(
    surface: Surface,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<Entity<WebView>> {
    let nonce = bridge::nonce();
    let origin = surface.origin();
    let (tx, mut rx) = mpsc::unbounded::<Inbound>();

    let root = surface.root.clone();
    let ipc = tx.clone();
    let nav = tx.clone();
    let popup = tx.clone();
    let nav_origin = origin.clone();
    let builder = wry::WebViewBuilder::new()
        .with_custom_protocol(surface.scheme.to_string(), move |_, request| {
            assets::serve(&root, &request)
        })
        .with_initialization_script_for_main_only(bridge::init_script(&nonce), true)
        .with_ipc_handler(move |request| {
            let _ = ipc.unbounded_send(Inbound::Ipc(request.into_body()));
        })
        .with_navigation_handler(move |url| match navigation::decide(&url, &nav_origin) {
            Decision::Allow => true,
            Decision::OpenExternally => {
                let _ = nav.unbounded_send(Inbound::OpenExternally(url));
                false
            }
            Decision::Refuse => {
                log::warn!("refused navigation to {url}");
                false
            }
        })
        .with_new_window_req_handler(move |url, _| {
            if navigation::externally_openable(&url) {
                let _ = popup.unbounded_send(Inbound::OpenExternally(url));
            }
            wry::NewWindowResponse::Deny
        })
        .with_devtools(std::env::var("WE_GPUI_DEVTOOLS").is_ok())
        .with_bounds(initial_bounds())
        .with_url(surface.start_url());
    drop(tx);

    let webview = WebView::build(builder, window, cx)?;
    #[cfg(target_os = "linux")]
    enable_media(webview.raw());
    let entity = cx.new(|_| webview);

    let weak = entity.downgrade();
    let label = surface.label;
    cx.spawn(async move |cx| {
        while let Some(inbound) = rx.next().await {
            match inbound {
                Inbound::OpenExternally(url) => cx.update(|cx| cx.open_url(&url)),
                Inbound::Ipc(body) => {
                    let request = match bridge::parse(&body, &nonce) {
                        Ok(request) => request,
                        Err(refused) => {
                            log::warn!("{label}: {refused}");
                            continue;
                        }
                    };
                    let weak = weak.clone();
                    // Each call runs on its own, so a slow one (a restart, a dialog) does not
                    // hold up the next.
                    cx.spawn(async move |cx| {
                        let (id, cmd) = (request.id, request.cmd.clone());
                        let result = commands::dispatch(label, request, cx).await;
                        // The command's name and outcome only: arguments carry passwords.
                        log::debug!("{label}: {cmd} -> {}", if result.is_ok() { "ok" } else { "error" });
                        reply(&weak, &bridge::settle_script(id, &result), cx);
                    })
                    .detach();
                }
            }
        }
    })
    .detach();
    Ok(entity)
}

/// Runs `script` in the webview, if it is still there.
pub fn reply(webview: &WeakEntity<WebView>, script: &str, cx: &mut AsyncApp) {
    let _ = webview.update(cx, |webview, _| {
        if let Err(e) = webview.raw().evaluate_script(script) {
            log::warn!("could not answer the page: {e}");
        }
    });
}

/// Delivers `event` to the app window's listeners.
pub fn emit_to_main(event: &str, payload: &Value, cx: &mut App) {
    let shell = cx.global::<Shell>().clone();
    let main = shell.main.borrow();
    if let Some(refs) = main.as_ref() {
        let script = bridge::emit_script(event, payload);
        let _ = refs.webview.update(cx, |webview, _| webview.raw().evaluate_script(&script));
    }
}

/// Opens the app window, or brings the open one forward.
pub fn open_main(cx: &mut App) -> anyhow::Result<()> {
    let shell = cx.global::<Shell>().clone();
    if let Some(refs) = shell.main.borrow().as_ref() {
        let _ = refs.window.update(cx, |_, window, _| window.activate_window());
        return Ok(());
    }
    if !shell.webviews_supported {
        anyhow::bail!("this session runs GPUI on native Wayland, where no webview can be embedded");
    }
    let surface = Surface {
        label: we_custody::window::MAIN,
        scheme: assets::APP_SCHEME,
        root: shell.dist.clone(),
        dev_url: shell.dev_url.clone(),
    };
    let url = surface.start_url();
    let mut built = None;
    let handle = cx.open_window(window_options("WE", 1280., 800., true, cx), |window, cx| {
        close_in_order(window, cx);
        let webview = build_webview(surface, window, cx);
        cx.new(|_| match webview {
            Ok(webview) => {
                built = Some(webview.downgrade());
                WebViewWindowOrError::WebView(webview)
            }
            Err(e) => WebViewWindowOrError::Error(format!("{e:#}")),
        })
    })?;
    if let Some(webview) = built {
        *shell.main.borrow_mut() = Some(MainRefs { window: handle.into(), webview, url });
    }
    Ok(())
}

/// Reloads the app window's page — after a restart, so it connects to the new executor.
pub fn reload_main(cx: &mut App) {
    let shell = cx.global::<Shell>().clone();
    if let Some(refs) = shell.main.borrow().as_ref() {
        let _ = refs.webview.update(cx, |webview, _| webview.raw().load_url(&refs.url));
    }
}

/// Opens the identity window on its own scheme, rooted at the identity bundle.
pub fn open_identity(cx: &mut App) -> anyhow::Result<AnyWindowHandle> {
    let shell = cx.global::<Shell>().clone();
    let surface = Surface {
        label: we_custody::window::IDENTITY,
        scheme: assets::IDENTITY_SCHEME,
        root: shell.dist.join("identity"),
        dev_url: None,
    };
    let handle = cx.open_window(
        window_options("WE — your identity", 480., 640., false, cx),
        |window, cx| {
            close_in_order(window, cx);
            let webview = build_webview(surface, window, cx);
            cx.new(|_| match webview {
                Ok(webview) => WebViewWindowOrError::WebView(webview),
                Err(e) => WebViewWindowOrError::Error(format!("{e:#}")),
            })
        },
    )?;
    Ok(handle.into())
}

/// A webview window, or why it could not be built — shown rather than an empty window.
pub enum WebViewWindowOrError {
    WebView(Entity<WebView>),
    Error(String),
    /// Its webview has been let go, and the window is about to be removed (`close_webview_window`).
    Released,
}

impl Render for WebViewWindowOrError {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        match self {
            WebViewWindowOrError::WebView(inner) => div()
                .size_full()
                .flex()
                .child(inner.clone())
                .into_any_element(),
            WebViewWindowOrError::Released => div().size_full().into_any_element(),
            WebViewWindowOrError::Error(message) => div()
                .size_full()
                .p_4()
                .bg(rgb(0x1e1e2e))
                .text_color(rgb(0xffffff))
                .child(format!("The webview could not be created: {message}"))
                .into_any_element(),
        }
    }
}

/// How long a released webview is given to be torn down before its window goes.
const RELEASE_GRACE: std::time::Duration = std::time::Duration::from_millis(100);

/// Closes a webview window in the order its webview needs: the webview first, then the window.
///
/// The webview is a GTK child of the GPUI window's X11 window. Removed the other way round, GTK
/// goes on configuring a child of a window that no longer exists, X answers `BadWindow`, and
/// GDK's error handler ends the process — which is how cancelling the identity window took the
/// whole app down. gpui-webview states the rule: every handle goes before the parent window.
pub fn close_webview_window(handle: AnyWindowHandle, cx: &mut App) {
    if let Some(typed) = handle.downcast::<WebViewWindowOrError>() {
        let _ = typed.update(cx, |view, _, cx| {
            *view = WebViewWindowOrError::Released;
            cx.notify();
        });
    }
    cx.spawn(async move |cx| {
        cx.background_executor().timer(RELEASE_GRACE).await;
        let _ = handle.update(cx, |_, window, _| window.remove_window());
    })
    .detach();
}

/// Routes a close from the window manager through [`close_webview_window`].
fn close_in_order(window: &Window, cx: &App) {
    window.on_window_should_close(cx, |window, cx| {
        let handle = window.window_handle();
        // Deferred: this runs inside the window's own update, where it cannot be updated again.
        cx.defer(move |cx| close_webview_window(handle, cx));
        false
    });
}

pub fn window_options(title: &str, w: f32, h: f32, resizable: bool, cx: &App) -> WindowOptions {
    WindowOptions {
        titlebar: Some(TitlebarOptions {
            title: Some(title.to_string().into()),
            ..Default::default()
        }),
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(px(w), px(h)),
            cx,
        ))),
        is_resizable: resizable,
        focus: true,
        ..Default::default()
    }
}

/// The identity window closed: the step ends. An unfinished one is cancelled and its secrets
/// wiped by the custody service; the app window hears how it ended either way — never a screen.
pub fn identity_closed(cx: &mut App) {
    let shell = cx.global::<Shell>().clone();
    let (kind, ended) = {
        let mut slot = shell.identity.borrow_mut();
        slot.window = None;
        let ended = slot.outcome.take().unwrap_or(StepOutcome::Cancelled);
        (step_kind(&slot.step.take()), ended)
    };
    if ended == StepOutcome::Cancelled {
        let custody = shell.custody.clone();
        shell.runtime.spawn(async move { custody.cancel().await });
    }
    emit_to_main(
        "identity-step-done",
        &serde_json::json!({ "step": kind, "outcome": ended }),
        cx,
    );
}

pub fn step_kind(step: &Option<IdentityStep>) -> &'static str {
    match step {
        Some(IdentityStep::Create) => "create",
        Some(IdentityStep::AddDevice) => "add-device",
        Some(IdentityStep::Revoke { .. }) => "revoke",
        None => "",
    }
}

/// Let the webview reach the camera and microphone — and nothing else. The Tauri host's
/// `enable_media`, applied to this webview: WebKitGTK has both off and answers every permission
/// request with no unless the application says otherwise.
#[cfg(target_os = "linux")]
fn enable_media(webview: &wry::WebView) {
    use webkit2gtk::glib::object::Cast;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
    use wry::WebViewExtUnix;

    let view = webview.webview();
    if let Some(settings) = WebViewExt::settings(&view) {
        settings.set_enable_media_stream(true);
        settings.set_enable_webrtc(true);
        settings.set_enable_media(true);
    }
    view.connect_permission_request(|_, request| {
        if request.downcast_ref::<UserMediaPermissionRequest>().is_some() {
            request.allow();
        } else {
            request.deny();
        }
        true
    });
}

/// The bounds a webview is built with, before the first layout places it.
///
/// They are physical on purpose. wry's X11 path converts *logical* initial bounds with a scale
/// it derives from the screen's size in millimetres, and an X server that reports no physical
/// size (XWayland under GNOME does) makes that scale infinite and wry panics in `dpi`. Physical
/// bounds are passed through unscaled; the first layout replaces them with the real ones, and
/// that path uses GTK's own integer scale.
fn initial_bounds() -> wry::Rect {
    wry::Rect {
        position: wry::dpi::PhysicalPosition::new(0, 0).into(),
        size: wry::dpi::PhysicalSize::new(1u32, 1u32).into(),
    }
}

#[cfg(test)]
mod tests {
    use super::initial_bounds;

    #[test]
    fn initial_bounds_survive_a_screen_with_no_physical_size() {
        // What wry computes for a screen whose width in millimetres is 0.
        let scale = 1280.0 * 25.4 / 0.0 / 96.0;
        assert!(f64::is_infinite(scale));
        let bounds = initial_bounds();
        let (x, y): (f64, f64) = bounds.position.to_physical::<f64>(scale).into();
        let (w, h): (u32, u32) = bounds.size.to_physical::<u32>(scale).into();
        assert_eq!((x, y, w, h), (0.0, 0.0, 1, 1));
    }

    #[test]
    fn logical_bounds_are_what_panicked() {
        let scale = 1280.0 * 25.4 / 0.0 / 96.0;
        let logical = wry::Rect::default();
        let caught = std::panic::catch_unwind(|| logical.position.to_physical::<f64>(scale));
        assert!(caught.is_err(), "dpi accepted an infinite scale; the workaround may be unneeded");
    }
}
