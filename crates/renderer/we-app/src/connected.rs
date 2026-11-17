//! `we-app --connect`: the window that talks to a live executor (E7).
//!
//! Three stages, each a plain egui screen until they become template screens:
//!
//! 1. **Connect** — what [`ConnectFlow`] is doing: searching, waiting for the
//!    launcher's approval code (or a multi-user email, code or password),
//!    connected, locked, or failed with the reason and a retry.
//! 2. **Pick a space** — the agent's perspectives, shared first. `--space`
//!    skips it.
//! 3. **The space** — the Coasys app against live data ([`crate::live`]),
//!    under a status bar; F11 opens the data panel that says which store
//!    members are live and which still come from the snapshot.
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use egui::{Color32, RichText};
use we_ad4m::connect::{Ask, ConnectFlow, ConnectPhase, ConnectSettings, GrantScope};
use we_ad4m::{Access, Connection, Notices, SpaceRow, WriteHost};
use we_data::writes::Confirm;

use crate::live::{live_space_app, LiveSpace};

/// What `--connect` was given.
#[derive(Debug, Clone, Default)]
pub struct ConnectArgs {
    pub settings: ConnectSettings,
    /// `--space <uuid or name>`: open it as soon as the list arrives.
    pub space: Option<String>,
    pub theme: String,
    /// `--demo-recorded`: the recording under the live data (off by default).
    pub data: crate::live::DataMode,
    /// `--write`: whether the open space may be changed (E11). The grant
    /// asked for is `settings.scope`.
    pub access: we_ad4m::Access,
}

type Pending<T> = Arc<Mutex<Option<Result<T, String>>>>;

enum Stage {
    Connect {
        input: String,
    },
    Pick {
        conn: Connection,
        url: String,
        spaces: Pending<Vec<SpaceRow>>,
        filter: String,
        error: Option<String>,
    },
    Space {
        conn: Connection,
        url: String,
        live: Box<LiveSpace>,
        panel: bool,
    },
}

pub struct ConnectedApp {
    rt: we_ad4m::Runtime,
    bundle: we_template::Bundle,
    args: ConnectArgs,
    ctx: egui::Context,
    /// The connect session, for as long as the window is connected — not
    /// just while the connect screen is up (Lal F5). It owns the token's
    /// refusal watch: a grant removed in the launcher flips it to Failed,
    /// and the window goes back to the connect screen to say so.
    flow: ConnectFlow,
    stage: Stage,
    /// `--space` is applied once; going back to the picker leaves it alone.
    auto_space: Option<String>,
}

impl ConnectedApp {
    pub fn new(ctx: egui::Context, bundle: we_template::Bundle, args: ConnectArgs) -> Self {
        let rt = we_ad4m::Runtime::new().expect("the adapter runtime starts");
        let flow = start_flow(&rt, &ctx, &args.settings);
        Self {
            rt,
            bundle,
            auto_space: args.space.clone(),
            args,
            ctx,
            flow,
            stage: Stage::Connect {
                input: String::new(),
            },
        }
    }

    fn list_spaces(&self, conn: &Connection) -> Pending<Vec<SpaceRow>> {
        let pending: Pending<Vec<SpaceRow>> = Arc::default();
        let out = pending.clone();
        let conn2 = conn.clone();
        let ctx = self.ctx.clone();
        conn.spawn(async move {
            let r = we_ad4m::list_spaces(&conn2)
                .await
                .map_err(|e| format!("{e:#}"));
            if let Ok(mut p) = out.lock() {
                *p = Some(r);
            }
            ctx.request_repaint();
        });
        pending
    }

    fn open_space(&self, conn: &Connection, space: SpaceRow) -> Result<Box<LiveSpace>, String> {
        let (mut live, fell_back) = live_space_app(
            &self.bundle,
            conn,
            space,
            &self.args.theme,
            self.args.data,
            self.args.access,
        )?;
        if fell_back {
            eprintln!(
                "no recorded theme {:?}; painting with dark",
                self.args.theme
            );
        }
        let ctx = self.ctx.clone();
        live.app
            .session
            .set_waker(Arc::new(move || ctx.request_repaint()));
        // A notice or a confirmation appearing wakes the window too.
        let ctx = self.ctx.clone();
        if let Some(host) = live.app.session.host_mut_as::<WriteHost>() {
            host.set_waker(Arc::new(move || ctx.request_repaint()));
        }
        Ok(Box::new(live))
    }

    /// Which screen is up: `connect`, `pick` or `space`.
    pub fn stage(&self) -> &'static str {
        match self.stage {
            Stage::Connect { .. } => "connect",
            Stage::Pick { .. } => "pick",
            Stage::Space { .. } => "space",
        }
    }

    /// The open space, once one is.
    pub fn live_space(&mut self) -> Option<&mut LiveSpace> {
        match &mut self.stage {
            Stage::Space { live, .. } => Some(live),
            _ => None,
        }
    }

    pub fn ui(&mut self, ui: &mut egui::Ui) {
        if !matches!(self.stage, Stage::Connect { .. }) {
            // The session ended under an open screen — a token refused, a
            // grant removed: back to the connect screen, which says why.
            if let ConnectPhase::Failed { .. } = self.flow.phase() {
                self.stage = Stage::Connect {
                    input: String::new(),
                };
            } else {
                // The socket has no "dropped" callback to wake on; look again
                // twice a second so a lost connection shows.
                ui.ctx()
                    .request_repaint_after(std::time::Duration::from_millis(500));
            }
        }
        let flow = &self.flow;
        let next = match &mut self.stage {
            Stage::Connect { input } => connect_screen(ui, flow, &self.args.settings.scope, input),
            Stage::Pick {
                spaces,
                filter,
                error,
                url,
                conn,
            } => {
                let list = spaces.lock().ok().and_then(|s| s.clone());
                lost_banner(ui, conn).or(pick_screen(
                    ui,
                    url,
                    list,
                    filter,
                    error,
                    &mut self.auto_space,
                ))
            }
            Stage::Space {
                url,
                live,
                panel,
                conn,
            } => space_screen(ui, url, conn, live, panel),
        };
        if let Some(next) = next {
            self.go(next);
        }
    }

    fn go(&mut self, next: Next) {
        match next {
            Next::Retry => {
                self.flow = start_flow(&self.rt, &self.ctx, &self.args.settings);
                self.stage = Stage::Connect {
                    input: String::new(),
                };
            }
            Next::Connected(conn, url) => {
                let spaces = self.list_spaces(&conn);
                self.stage = Stage::Pick {
                    conn,
                    url,
                    spaces,
                    filter: String::new(),
                    error: None,
                };
            }
            Next::Open(space) => {
                let Stage::Pick { conn, url, .. } = &self.stage else {
                    return;
                };
                let (conn, url) = (conn.clone(), url.clone());
                match self.open_space(&conn, space) {
                    Ok(live) => {
                        self.stage = Stage::Space {
                            conn,
                            url,
                            live,
                            panel: false,
                        }
                    }
                    Err(e) => {
                        if let Stage::Pick { error, .. } = &mut self.stage {
                            *error = Some(e);
                        }
                    }
                }
            }
            Next::Back => {
                let Stage::Space { conn, url, .. } = &self.stage else {
                    return;
                };
                let (conn, url) = (conn.clone(), url.clone());
                self.go(Next::Connected(conn, url));
            }
        }
    }
}

enum Next {
    Retry,
    Connected(Connection, String),
    Open(SpaceRow),
    Back,
}

fn start_flow(
    rt: &we_ad4m::Runtime,
    ctx: &egui::Context,
    settings: &ConnectSettings,
) -> ConnectFlow {
    let ctx = ctx.clone();
    ConnectFlow::start(&rt.handle(), settings.clone(), move || {
        ctx.request_repaint()
    })
}

fn card(ui: &mut egui::Ui, body: impl FnOnce(&mut egui::Ui)) {
    ui.vertical_centered(|ui| {
        ui.add_space(ui.available_height() * 0.15);
        ui.set_max_width(520.0);
        egui::Frame::group(ui.style())
            .inner_margin(24.0)
            .show(ui, |ui| {
                ui.set_width(460.0);
                body(ui)
            });
    });
}

/// What the capability request asks for, as the connect screen says it.
pub fn grant_sentence(scope: &GrantScope) -> String {
    match scope {
        GrantScope::ReadOnly => {
            "It asks to read your agent and your perspectives, and nothing else (read-only)."
                .to_string()
        }
        GrantScope::Write { space } => format!(
            "It asks to read your agent and your perspectives, and to change one space \
             ({space}), and nothing else."
        ),
    }
}

fn connect_screen(
    ui: &mut egui::Ui,
    flow: &ConnectFlow,
    scope: &GrantScope,
    input: &mut String,
) -> Option<Next> {
    let phase = flow.phase();
    if let ConnectPhase::Connected { url } = &phase {
        if let Some(conn) = flow.take_connection() {
            return Some(Next::Connected(conn, url.clone()));
        }
    }
    let mut next = None;
    card(ui, |ui| {
        ui.heading("Connect to AD4M");
        ui.add_space(12.0);
        match &phase {
            ConnectPhase::Searching => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Looking for your AD4M executor…");
                });
            }
            ConnectPhase::Checking => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Checking with the executor…");
                });
            }
            ConnectPhase::Connected { url } => {
                ui.label(format!("Connected to {url}."));
            }
            ConnectPhase::Asking { ask, note } => {
                let (prompt, secret) = match ask {
                    Ask::CapabilityCode { request_id } => (
                        format!(
                            "This app asked for access (request {request_id}).\n\
                             {}\n\
                             Approve it in the AD4M launcher, then type the 6-digit code it shows.",
                            grant_sentence(scope)
                        ),
                        true,
                    ),
                    Ask::Email => ("This executor has accounts. Your email:".to_string(), false),
                    Ask::EmailCode { email } => {
                        (format!("Type the code emailed to {email}."), true)
                    }
                    Ask::Password {
                        email,
                        new_account: true,
                    } => (
                        format!("No account for {email} yet — choose a password."),
                        true,
                    ),
                    Ask::Password { email, .. } => (format!("Password for {email}:"), true),
                };
                ui.label(prompt);
                if let Some(note) = note {
                    ui.colored_label(Color32::from_rgb(230, 160, 60), note);
                }
                ui.add_space(8.0);
                let field = ui.add(
                    egui::TextEdit::singleline(input)
                        .password(secret)
                        .desired_width(f32::INFINITY),
                );
                let enter = field.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                if !field.has_focus() && input.is_empty() {
                    field.request_focus();
                }
                if (ui.button("Continue").clicked() || enter) && !input.trim().is_empty() {
                    flow.answer(std::mem::take(input));
                }
            }
            ConnectPhase::Locked { url } => {
                ui.label(format!(
                    "The executor at {url} is locked. Unlock it in the AD4M launcher, then retry."
                ));
                if ui.button("Retry").clicked() {
                    next = Some(Next::Retry);
                }
            }
            ConnectPhase::Failed { reason } => {
                ui.colored_label(Color32::from_rgb(230, 90, 90), "Could not connect.");
                ui.label(reason);
                ui.add_space(8.0);
                if ui.button("Retry").clicked() {
                    next = Some(Next::Retry);
                }
            }
        }
    });
    next
}

fn pick_screen(
    ui: &mut egui::Ui,
    url: &str,
    list: Option<Result<Vec<SpaceRow>, String>>,
    filter: &mut String,
    error: &mut Option<String>,
    auto: &mut Option<String>,
) -> Option<Next> {
    if let (Some(Ok(spaces)), Some(want)) = (&list, auto.as_ref()) {
        let found = spaces
            .iter()
            .find(|s| &s.uuid == want || s.shared_url.as_ref() == Some(want))
            .or_else(|| spaces.iter().find(|s| &s.name == want));
        match found {
            Some(space) => {
                *auto = None;
                return Some(Next::Open(space.clone()));
            }
            None => {
                *error = Some(format!("--space {want:?}: no such perspective here"));
                *auto = None;
            }
        }
    }
    let mut next = None;
    card(ui, |ui| {
        ui.heading("Open a space");
        ui.label(RichText::new(format!("Connected to {url}")).weak());
        ui.add_space(8.0);
        if let Some(e) = error {
            ui.colored_label(Color32::from_rgb(230, 90, 90), e.as_str());
        }
        match &list {
            None => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Reading your perspectives…");
                });
            }
            Some(Err(e)) => {
                ui.colored_label(
                    Color32::from_rgb(230, 90, 90),
                    format!("Could not list them: {e}"),
                );
            }
            Some(Ok(spaces)) if spaces.is_empty() => {
                ui.label("This agent holds no perspectives yet. Make a space in WE first.");
            }
            Some(Ok(spaces)) => {
                ui.add(egui::TextEdit::singleline(filter).hint_text("Filter…"));
                ui.add_space(6.0);
                egui::ScrollArea::vertical()
                    .max_height(420.0)
                    .show(ui, |ui| {
                        let f = filter.to_lowercase();
                        for space in spaces
                            .iter()
                            .filter(|s| f.is_empty() || s.name.to_lowercase().contains(&f))
                        {
                            let kind = if space.is_shared() { "shared" } else { "local" };
                            let label = format!("{}   ({kind})", space.name);
                            let resp = ui
                                .add_sized([ui.available_width(), 28.0], egui::Button::new(label))
                                .on_hover_text(&space.uuid);
                            if resp.clicked() {
                                next = Some(Next::Open(space.clone()));
                            }
                        }
                    });
            }
        }
    });
    next
}

/// Above the picker: the socket dropped. `ad4m-client` keeps redialling;
/// Reconnect starts the connect flow over.
fn lost_banner(ui: &mut egui::Ui, conn: &Connection) -> Option<Next> {
    if conn.is_connected() {
        return None;
    }
    let mut next = None;
    ui.horizontal(|ui| {
        ui.colored_label(LOST, "Connection lost — reconnecting…");
        if ui.button("Reconnect").clicked() {
            next = Some(Next::Retry);
        }
    });
    next
}

const LIVE: Color32 = Color32::from_rgb(90, 200, 120);
const LOST: Color32 = Color32::from_rgb(230, 160, 60);

fn space_screen(
    ui: &mut egui::Ui,
    url: &str,
    conn: &Connection,
    live: &mut LiveSpace,
    panel: &mut bool,
) -> Option<Next> {
    if ui.input(|i| i.key_pressed(egui::Key::F11)) {
        *panel = !*panel;
    }
    let report = live.provenance.report();
    let mut next = None;
    egui::Panel::top("we-live-status").show(ui, |ui| {
        ui.horizontal(|ui| {
            // A painted dot: the default fonts have no "●".
            let (dot, _) = ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
            let connected = conn.is_connected();
            ui.painter()
                .circle_filled(dot.center(), 4.0, if connected { LIVE } else { LOST });
            ui.label(format!("{url}  ·  {}", live.space.name));
            ui.label(match live.access {
                Access::ReadOnly => "read-only".to_string(),
                Access::Write => format!("writes: {}", live.space.name),
            });
            if !connected {
                // What is on screen is the last answer; nothing updates
                // until the socket is back.
                ui.colored_label(LOST, "Connection lost — reconnecting…");
                if ui.button("Reconnect").clicked() {
                    next = Some(Next::Retry);
                }
            }
            ui.separator();
            ui.label(
                RichText::new(format!(
                    "live queries {}  ·  results {}  ·  failed {}  ·  members live {} / unavailable {}{}",
                    live.source.open.load(Ordering::Relaxed),
                    live.source.deliveries.load(Ordering::Relaxed),
                    live.source.failures.load(Ordering::Relaxed),
                    report.live_served.len(),
                    report.unavailable.len(),
                    if live.mode == crate::live::DataMode::DemoRecorded {
                        format!("  ·  RECORDED DEMO DATA {}", report.snapshot_served.len())
                    } else {
                        String::new()
                    },
                ))
                .monospace()
                .size(11.0),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Switch space").clicked() {
                    next = Some(Next::Back);
                }
                if ui.selectable_label(*panel, "Data (F11)").clicked() {
                    *panel = !*panel;
                }
            });
        });
    });
    if *panel {
        egui::Panel::right("we-live-data")
            .default_size(320.0)
            .show(ui, |ui| data_panel(ui, live, &report));
    }
    egui::CentralPanel::default()
        .frame(egui::Frame::NONE)
        .show(ui, |ui| live.app.frame_body(ui));
    // What went wrong with a write: top right, below the status bar, gone
    // after eight seconds unless dismissed sooner.
    let notices = live.notice_list().clone();
    notices.expire(NOTICE_LIFE);
    if !notices.list().is_empty() {
        let top = ui.max_rect().top() + 40.0;
        egui::Area::new(egui::Id::unique("we-write-notices"))
            .order(egui::Order::Foreground)
            .anchor(egui::Align2::RIGHT_TOP, egui::vec2(-12.0, top))
            .show(ui.ctx(), |ui| draw_notices(ui, &notices, &live.app.theme));
        ui.ctx().request_repaint_after(NOTICE_LIFE);
    }
    if let Some(confirm) = live.pending_confirm() {
        if let Some(yes) = draw_confirm(ui, &confirm) {
            live.answer_confirm(yes);
        }
    }
    next
}

/// How long a notice stays up.
const NOTICE_LIFE: std::time::Duration = std::time::Duration::from_secs(8);

/// The notices, one framed line each in the theme's danger colours, with a
/// Dismiss button.
pub fn draw_notices(ui: &mut egui::Ui, notices: &Notices, theme: &we_style::Theme) {
    let fill = crate::gallery::role_color(theme, "danger-soft")
        .unwrap_or_else(|| ui.visuals().extreme_bg_color);
    let text = crate::gallery::role_color(theme, "danger-text")
        .unwrap_or_else(|| ui.visuals().error_fg_color);
    let mut dismiss = None;
    for (i, notice) in notices.list().iter().enumerate() {
        egui::Frame::new()
            .fill(fill)
            .corner_radius(6.0)
            .inner_margin(10.0)
            .show(ui, |ui| {
                ui.set_max_width(420.0);
                ui.horizontal_top(|ui| {
                    ui.add(egui::Label::new(RichText::new(&notice.text).color(text)).wrap());
                    if ui.small_button("Dismiss").clicked() {
                        dismiss = Some(i);
                    }
                });
            });
        ui.add_space(6.0);
    }
    if let Some(i) = dismiss {
        notices.dismiss(i);
    }
}

/// The host's confirmation of a destructive call: `Some(true)` on Delete,
/// `Some(false)` on Cancel, Escape or a click outside, `None` while open.
pub fn draw_confirm(ui: &mut egui::Ui, confirm: &Confirm) -> Option<bool> {
    let mut answer = None;
    let modal = egui::Modal::new(egui::Id::unique("we-write-confirm")).show(ui.ctx(), |ui| {
        ui.set_max_width(380.0);
        ui.heading(&confirm.title);
        ui.add_space(6.0);
        ui.label(&confirm.body);
        ui.add_space(12.0);
        ui.horizontal(|ui| {
            if ui.button("Cancel").clicked() {
                answer = Some(false);
            }
            let danger = ui.visuals().error_fg_color;
            if ui
                .button(RichText::new("Delete").color(danger).strong())
                .clicked()
            {
                answer = Some(true);
            }
        });
    });
    if answer.is_none() && modal.should_close() {
        answer = Some(false);
    }
    answer
}

fn data_panel(ui: &mut egui::Ui, live: &LiveSpace, report: &we_data::ProvenanceReport) {
    egui::ScrollArea::vertical().show(ui, |ui| {
        ui.heading("Where the data comes from");
        ui.label(
            RichText::new(
                "Every $queries entry reads the executor, and so do store members with a live row. \
                 The rest are unavailable, except the bundle's themes and brand and the facts of \
                 connected mode. With --demo-recorded, the recording fills them instead.",
            )
            .weak(),
        );
        let section = |ui: &mut egui::Ui, title: &str, color: Color32, items: &[String]| {
            ui.add_space(8.0);
            ui.label(
                RichText::new(format!("{title} ({})", items.len()))
                    .strong()
                    .color(color),
            );
            for m in items {
                ui.label(RichText::new(m).monospace().size(11.0));
            }
        };
        let waiting: Vec<String> = live
            .live_members
            .iter()
            .filter(|m| !report.live_served.contains(m))
            .cloned()
            .collect();
        section(
            ui,
            "Live",
            Color32::from_rgb(90, 200, 120),
            &report.live_served,
        );
        section(ui, "Live, not read yet", Color32::GRAY, &waiting);
        let recorded = if live.mode == crate::live::DataMode::DemoRecorded {
            "Recorded (demo mix)"
        } else {
            "Bundle and connected facts"
        };
        section(
            ui,
            recorded,
            Color32::from_rgb(230, 160, 60),
            &report.snapshot_served,
        );
        section(ui, "Unavailable", Color32::GRAY, &report.unavailable);
        section(ui, "Derived", Color32::LIGHT_BLUE, &report.native_served);
        section(
            ui,
            "Calls dropped (not wired)",
            Color32::from_rgb(230, 90, 90),
            &live.dropped_calls(),
        );
    });
}
