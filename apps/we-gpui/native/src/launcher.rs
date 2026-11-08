//! The executor window: a native GPUI surface, drawn from real state — the supervisor's process
//! and what the executor itself answers over its RPC (version, commit, the agent's DID, whether it
//! is initialised and unlocked) — and the account list from the registry the other shells share.
//!
//! It needs no webview, so it runs on native Wayland too, where the app window cannot.

use std::time::Duration;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{ActiveTheme, Disableable, h_flex, v_flex};
use gpui_kit::*;

use crate::accounts::Account;
use crate::executor::{Phase, Snapshot};
use crate::shell::{self, Shell};

pub struct Launcher {
    snapshot: Snapshot,
    accounts: Vec<Account>,
    busy: bool,
    message: Option<String>,
}

impl Launcher {
    pub fn new(cx: &mut Context<Self>) -> Self {
        // Refresh from the supervisor once a second; the supervisor's own watcher asks the
        // executor every two.
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                if this.update(cx, |this, cx| this.refresh(cx)).is_err() {
                    return;
                }
            }
        })
        .detach();
        let mut this = Launcher {
            snapshot: Snapshot::default(),
            accounts: Vec::new(),
            busy: false,
            message: None,
        };
        this.refresh(cx);
        this
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        let shell = cx.global::<Shell>().clone();
        self.snapshot = shell.supervisor.snapshot();
        self.accounts = shell.registry().list();
        cx.notify();
    }

    fn start(&mut self, cx: &mut Context<Self>) {
        let shell = cx.global::<Shell>().clone();
        let launch = shell.launch();
        let (runtime, supervisor) = (shell.runtime.clone(), shell.supervisor.clone());
        self.run(cx, async move { runtime.spawn(async move { supervisor.start(launch).await }).await });
    }

    fn stop(&mut self, cx: &mut Context<Self>) {
        let shell = cx.global::<Shell>().clone();
        let (runtime, supervisor) = (shell.runtime.clone(), shell.supervisor.clone());
        self.run(cx, async move {
            runtime
                .spawn_blocking(move || {
                    supervisor.stop();
                    Ok(())
                })
                .await
        });
    }

    fn restart(&mut self, cx: &mut Context<Self>) {
        self.busy = true;
        self.message = None;
        cx.spawn(async move |this, cx| {
            let shell = cx.update(|cx| cx.global::<Shell>().clone());
            let result = crate::commands::restart(&shell, cx).await;
            let _ = this.update(cx, |this, cx| {
                this.busy = false;
                this.message = result.err();
                this.refresh(cx);
            });
        })
        .detach();
    }

    /// Runs a supervisor action off the UI thread and shows how it ended.
    fn run(
        &mut self,
        cx: &mut Context<Self>,
        action: impl Future<Output = Result<Result<(), String>, tokio::task::JoinError>> + 'static,
    ) {
        self.busy = true;
        self.message = None;
        cx.spawn(async move |this, cx| {
            let result = match action.await {
                Ok(result) => result,
                Err(e) => Err(e.to_string()),
            };
            let _ = this.update(cx, |this, cx| {
                this.busy = false;
                this.message = result.err();
                this.refresh(cx);
            });
        })
        .detach();
    }

    fn open_we(&mut self, cx: &mut Context<Self>) {
        if let Err(e) = shell::open_main(cx) {
            self.message = Some(format!("{e:#}"));
            cx.notify();
        }
    }
}

fn phase_text(phase: &Phase) -> String {
    match phase {
        Phase::Stopped => "Stopped".into(),
        Phase::Initialising => "Initialising".into(),
        Phase::Starting => "Starting…".into(),
        Phase::Running => "Running".into(),
        Phase::Stopping => "Stopping…".into(),
        Phase::Exited(Some(code)) => format!("Exited ({code})"),
        Phase::Exited(None) => "Exited (signal)".into(),
        Phase::Failed(why) => format!("Failed: {why}"),
    }
}

fn yes_no(value: Option<bool>) -> String {
    match value {
        Some(true) => "yes".into(),
        Some(false) => "no".into(),
        None => "—".into(),
    }
}

impl Render for Launcher {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let shell = cx.global::<Shell>().clone();
        let s = &self.snapshot;
        let running = matches!(s.phase, Phase::Running);
        let idle = matches!(s.phase, Phase::Stopped | Phase::Exited(_) | Phase::Failed(_));
        let phase_color = match s.phase {
            Phase::Running => theme.success,
            Phase::Failed(_) | Phase::Exited(_) => theme.danger,
            _ => theme.muted_foreground,
        };

        let row = |label: &'static str, value: String| {
            h_flex()
                .gap_3()
                .py_1()
                .border_b_1()
                .border_color(theme.border)
                .child(div().w(px(130.)).text_color(theme.muted_foreground).child(label))
                .child(div().flex_1().overflow_hidden().child(value))
        };

        let version = match (&s.version, &s.commit) {
            (Some(v), Some(c)) => format!("{v} ({})", &c[..c.len().min(9)]),
            (Some(v), None) => v.clone(),
            _ => "—".into(),
        };

        let accounts = v_flex().gap_1().children(self.accounts.iter().map(|account| {
            h_flex()
                .gap_2()
                .child(
                    div()
                        .w(px(8.))
                        .h(px(8.))
                        .rounded_full()
                        .bg(if account.active { theme.success } else { theme.border }),
                )
                .child(account.name.clone())
                .child(
                    div()
                        .text_color(theme.muted_foreground)
                        .child(if account.has_agent { "has an identity" } else { "no identity yet" }),
                )
        }));

        v_flex()
            .size_full()
            .p_5()
            .gap_4()
            .bg(theme.background)
            .text_color(theme.foreground)
            .text_sm()
            .child(
                h_flex()
                    .justify_between()
                    .child(div().text_xl().font_weight(FontWeight::SEMIBOLD).child("WE — executor"))
                    .child(div().text_color(phase_color).child(phase_text(&s.phase))),
            )
            .child(
                v_flex()
                    .child(row("Process", s.pid.map(|p| format!("pid {p}")).unwrap_or("—".into())))
                    .child(row("RPC", format!("127.0.0.1:{}", shell.port)))
                    .child(row("Version", version))
                    .child(row("Agent", s.did.clone().unwrap_or("—".into())))
                    .child(row("Initialised", yes_no(s.initialized)))
                    .child(row("Unlocked", yes_no(s.unlocked)))
                    .child(row(
                        "Ready after",
                        s.ready_after_ms.map(|ms| format!("{ms} ms")).unwrap_or("—".into()),
                    ))
                    .child(row("Data path", s.data_path.clone()))
                    .child(row("Log", s.log_path.clone().unwrap_or("—".into()))),
            )
            .child(div().font_weight(FontWeight::SEMIBOLD).child("Accounts"))
            .child(accounts)
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("start")
                            .primary()
                            .label("Start")
                            .disabled(self.busy || !idle)
                            .on_click(cx.listener(|this, _, _, cx| this.start(cx))),
                    )
                    .child(
                        Button::new("stop")
                            .danger()
                            .label("Stop")
                            .disabled(self.busy || idle)
                            .on_click(cx.listener(|this, _, _, cx| this.stop(cx))),
                    )
                    .child(
                        Button::new("restart")
                            .label("Restart")
                            .disabled(self.busy || !running)
                            .on_click(cx.listener(|this, _, _, cx| this.restart(cx))),
                    )
                    .child(
                        Button::new("open")
                            .label(if shell.webviews_supported {
                                "Open WE"
                            } else {
                                "Open WE (needs X11)"
                            })
                            .disabled(!running || !shell.webviews_supported)
                            .on_click(cx.listener(|this, _, _, cx| this.open_we(cx))),
                    ),
            )
            .children(
                self.message
                    .clone()
                    .map(|m| div().text_color(theme.danger).child(m)),
            )
    }
}
