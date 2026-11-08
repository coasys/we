//! WE's GPUI desktop shell (a spike — see `../SPIKE.md`).
//!
//! Two windows by default: the executor window, native GPUI (`launcher.rs`), and the app window,
//! WE's web build in a wry webview embedded in a GPUI window (`shell.rs`). The executor runs as a
//! supervised child (`executor.rs`); custody runs in this process, as the Tauri app links it.
//!
//! On Linux the webview needs X11 (XWayland is fine): GTK cannot embed into a Wayland surface it
//! does not own. `--launcher` (or `WE_GPUI_WINDOWING=wayland`, which implies it) runs only the
//! native window, which works on native Wayland too.

#[path = "../../../we-tauri/src-tauri/src/accounts.rs"]
#[allow(dead_code)]
mod accounts;
#[path = "../../../we-tauri/src-tauri/src/executor_log.rs"]
#[allow(dead_code)]
mod executor_log;

mod assets;
mod bridge;
mod commands;
mod config;
mod executor;
mod launcher;
mod navigation;
mod shell;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use gpui_kit::*;

use crate::shell::Shell;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Windowing {
    X11,
    Wayland,
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let launched = Instant::now();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let windowing = match std::env::var("WE_GPUI_WINDOWING").as_deref() {
        Ok("wayland") => Windowing::Wayland,
        _ => Windowing::X11,
    };
    let launcher_only = args.iter().any(|a| a == "--launcher") || windowing == Windowing::Wayland;
    // With `--no-launcher` only the app window opens, as the other shells do.
    let show_launcher = !args.iter().any(|a| a == "--no-launcher");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio runtime");
    let handle = runtime.handle().clone();

    let port = config::find_port(12000, 13000).expect("a free port in 12000..13000");
    let credential: Arc<str> = uuid::Uuid::new_v4().to_string().into();
    let home = config::home_dir();
    // Clear out any account whose setup was abandoned last session, as Tauri does.
    config::registry().prune_abandoned();

    let custody = {
        let _entered = handle.enter();
        let dir = we_custody::host::custody_dir(&home);
        we_custody::spawn(
            we_custody::DesktopVault::new(
                we_custody::store::system_store(dir.clone()),
                we_custody::PendingIncepts::file(dir),
            ),
            we_custody::ExecutorAddress {
                url: format!("http://127.0.0.1:{port}"),
                admin_credential: credential.clone(),
            },
        )
    };

    let shell = Shell {
        runtime: handle.clone(),
        supervisor: executor::Supervisor::new(handle.clone()),
        custody,
        port,
        credential,
        dist: config::dist_dir(std::env::var("WE_GPUI_DIST").ok()),
        dev_url: std::env::var("WE_GPUI_DEV_URL").ok().filter(|u| !u.is_empty()),
        binary: config::executor_binary(
            std::env::var("WE_AD4M_EXECUTOR").ok(),
            &config::repo_executor_build(),
        ),
        data_path_env: std::env::var("WE_AD4M_DATA_PATH").ok(),
        webviews_supported: windowing == Windowing::X11,
        identity: Rc::default(),
        main: Rc::default(),
        launcher: Rc::new(RefCell::new(None)),
    };

    let modes = match windowing {
        Windowing::X11 => WindowingModes::X11,
        Windowing::Wayland => WindowingModes::WAYLAND,
    };
    #[cfg(target_os = "linux")]
    let app = gpui_kit::platform::linux(modes);
    #[cfg(not(target_os = "linux"))]
    let app = {
        let _ = modes;
        gpui_kit::platform::application()
    };

    app.run(move |cx| {
        gpui_kit::init(cx);
        cx.set_global(shell.clone());

        // The quit path stops the executor; `AD4M_EXIT_WITH_PARENT` covers every other way out.
        cx.on_app_quit(|cx| {
            let supervisor = cx.global::<Shell>().supervisor.clone();
            supervisor.stop();
            async {}
        })
        .detach();
        cx.on_window_closed(|cx, _| {
            let shell = cx.global::<Shell>().clone();
            let identity = shell.identity.borrow().window;
            if let Some(identity) = identity
                && !cx.windows().contains(&identity)
            {
                shell::identity_closed(cx);
            }
            let main = shell.main.borrow().as_ref().map(|m| m.window);
            if let Some(main) = main
                && !cx.windows().contains(&main)
            {
                *shell.main.borrow_mut() = None;
            }
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();

        if show_launcher || launcher_only {
            match gpui_kit::open_window(
                shell::window_options("WE — executor", 620., 560., true, cx),
                cx,
                |_, cx| cx.new(launcher::Launcher::new),
            ) {
                Ok((window, _)) => *shell.launcher.borrow_mut() = Some(window),
                Err(e) => log::error!("could not open the executor window: {e:#}"),
            }
        }

        // Start the executor; open the app once it answers, so the page's first connection lands.
        let (supervisor, launch) = (shell.supervisor.clone(), shell.launch());
        let started = handle.spawn(async move { supervisor.start(launch).await });
        cx.spawn(async move |cx| {
            let result = started.await.map_err(|e| e.to_string()).and_then(|r| r);
            log::info!("executor start: {result:?} after {} ms", launched.elapsed().as_millis());
            if result.is_ok() && !launcher_only {
                cx.update(|cx| {
                    if let Err(e) = shell::open_main(cx) {
                        log::error!("could not open the app window: {e:#}");
                    }
                    log::info!("app window opened {} ms after launch", launched.elapsed().as_millis());
                });
            }
        })
        .detach();
    });

    // The runtime outlives the app loop: the quit path above uses it.
    drop(runtime);
}
