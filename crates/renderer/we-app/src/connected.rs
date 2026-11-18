//! `we-app --connect`: the window that talks to a live executor (E7).
//!
//! Two screens, and a moment between them while the perspective list arrives:
//!
//! 1. **Connect** — what [`ConnectFlow`] is doing: searching, waiting for the
//!    launcher's approval code (or a multi-user email, code or password),
//!    connected, locked, or failed with the reason and a retry.
//! 2. **The space** — the Coasys app against live data ([`crate::live`]).
//!    The left rail lists every space the agent holds (system perspectives
//!    aside). A click on a rail row opens that space through the host. A
//!    template invoke cannot. There is no space picker. F11 opens
//!    the data panel that says which store members are live and which still
//!    come from the snapshot.
//!
//! The window stays read-only until a write grant is asked for. `--write
//! --space <uuid>` still asks up front. Otherwise the first edit of a
//! personal space asks, and the refused edit is not replayed. A shared
//! space is not asked for.
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use egui::{Color32, RichText};
use we_ad4m::connect::{Ask, ConnectFlow, ConnectPhase, ConnectSettings, GrantScope};
use we_ad4m::{Connection, Notices, SpaceRow, WriteHost};
use we_data::writes::Confirm;
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

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
    /// The perspective list is in flight. Not a picker: nothing here asks
    /// which space to open.
    Opening {
        conn: Connection,
        url: String,
        spaces: Pending<Vec<SpaceRow>>,
        error: Option<String>,
    },
    /// Connected, and there is no space to open.
    Empty {
        conn: Connection,
        url: String,
        message: String,
    },
    Space {
        conn: Connection,
        url: String,
        live: Box<LiveSpace>,
        panel: bool,
        /// Every perspective from the connect, system ones included, so
        /// `--space` can name them. A rail click never opens a system one.
        spaces: Vec<SpaceRow>,
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
    /// `--space`, applied once when the list arrives.
    auto_space: Option<String>,
    /// A rail click writes the space id here. The window opens it.
    nav: Arc<Mutex<Option<String>>>,
    /// The first edit of a personal space writes that space's uuid here.
    grant_slot: Arc<Mutex<Option<String>>>,
    /// The write-grant connect flow, over the open space. It does not
    /// replace [`ConnectedApp::flow`] until the grant succeeds: the
    /// read-only token stays watched in the meantime.
    grant: Option<GrantAsk>,
}

/// A write grant in progress for one perspective.
struct GrantAsk {
    space: String,
    flow: ConnectFlow,
    input: String,
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
            nav: Arc::default(),
            grant_slot: Arc::default(),
            grant: None,
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

    fn open_space(
        &mut self,
        conn: &Connection,
        space: SpaceRow,
        spaces: &[SpaceRow],
    ) -> Result<Box<LiveSpace>, String> {
        let (mut live, fell_back) = live_space_app(
            &self.bundle,
            conn,
            space,
            &self.args.theme,
            self.args.data,
            self.args.access.clone(),
        )?;
        if fell_back {
            eprintln!(
                "no recorded theme {:?}; painting with dark",
                self.args.theme
            );
        }
        // Before the first paint, so the rail's first frame already lists
        // every space. A host member survives the live layer rebinding the
        // store root.
        live.app.session.runtime().bag().set_host_member(
            "spaceStore",
            "orderedSidebarItems",
            sidebar_items(spaces),
        );
        let ctx = self.ctx.clone();
        live.app
            .session
            .set_waker(Arc::new(move || ctx.request_repaint()));
        // A notice or a confirmation wakes the window too. A rail click is
        // taken on this thread, before the template's invoke runs.
        let ctx = self.ctx.clone();
        if let Some(host) = live.app.session.host_mut_as::<WriteHost>() {
            host.set_shared(live.space.shared_url.is_some());
            host.watch_grant(self.grant_slot.clone());
            host.set_waker(Arc::new(move || ctx.request_repaint()));
        }
        self.arm_rail(&mut live.app, spaces);
        Ok(Box::new(live))
    }

    /// The rail's clicks. Only an `app:` node whose nearest `data-we-id`
    /// is one of the agent's spaces fills the slot. System perspectives
    /// are not in that set. A space template cannot mint an `app:` id.
    fn arm_rail(&self, app: &mut crate::RendererApp, spaces: &[SpaceRow]) {
        let allowed: HashSet<String> = we_ad4m::agent_spaces(spaces)
            .into_iter()
            .map(|s| s.uuid)
            .collect();
        let nav = self.nav.clone();
        app.set_rail_click(move |root, node| {
            let Some(id) = rail_row_id(root, node, &allowed) else {
                return false;
            };
            let Ok(mut slot) = nav.lock() else {
                return false;
            };
            *slot = Some(id);
            true
        });
    }

    /// Which screen is up: `connect`, `opening`, `empty` or `space`.
    /// Never `pick` — there is no picker.
    pub fn stage(&self) -> &'static str {
        match self.stage {
            Stage::Connect { .. } => "connect",
            Stage::Opening { .. } => "opening",
            Stage::Empty { .. } => "empty",
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
                self.drop_grant();
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
        self.settle_opening();
        self.follow_rail();
        self.poll_grant();
        let flow = &self.flow;
        let next = match &mut self.stage {
            Stage::Connect { input } => connect_screen(ui, flow, &self.args.settings.scope, input),
            Stage::Opening {
                conn, url, error, ..
            } => lost_banner(ui, conn).or(opening_screen(ui, url, error)),
            Stage::Empty { conn, url, message } => {
                lost_banner(ui, conn).or(empty_screen(ui, url, message))
            }
            Stage::Space {
                url,
                live,
                panel,
                conn,
                ..
            } => space_screen(ui, url, conn, live, panel),
        };
        if let Some(next) = next {
            self.go(next);
        }
        self.draw_grant(ui);
    }

    /// The list arrived: open `--space`, or the first real space, or say
    /// there is nothing to open. An open that already failed stays put.
    fn settle_opening(&mut self) {
        let Stage::Opening { spaces, error, .. } = &self.stage else {
            return;
        };
        if error.is_some() {
            return;
        }
        let ready = match spaces.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => None,
        };
        let Some(ready) = ready else {
            return;
        };
        let Stage::Opening { conn, url, .. } = &self.stage else {
            return;
        };
        let (conn, url) = (conn.clone(), url.clone());
        match ready {
            Err(e) => {
                if let Stage::Opening { error, .. } = &mut self.stage {
                    *error = Some(e);
                }
            }
            Ok(rows) => {
                let want = self.auto_space.take();
                match landing(&rows, want.as_deref()) {
                    Landing::Open { space, missed } => match self.open_space(&conn, space, &rows) {
                        Ok(live) => {
                            if let Some(text) = missed {
                                live.notice_list().push(text);
                            }
                            self.stage = Stage::Space {
                                conn,
                                url,
                                live,
                                panel: false,
                                spaces: rows,
                            };
                        }
                        Err(e) => {
                            self.stage = Stage::Opening {
                                conn,
                                url,
                                spaces: Arc::new(Mutex::new(Some(Ok(rows)))),
                                error: Some(e),
                            };
                        }
                    },
                    Landing::None { message } => {
                        self.stage = Stage::Empty { conn, url, message };
                    }
                }
            }
        }
    }

    /// A host rail click names a space. Open it when it is one of the
    /// agent's spaces and not the one already open. A system perspective
    /// and an unknown id leave a notice and stay put.
    fn follow_rail(&mut self) {
        let id = match self.nav.lock() {
            Ok(mut slot) => slot.take(),
            Err(_) => return,
        };
        let Some(id) = id else {
            return;
        };
        let (conn, url, spaces, panel, current) = match &self.stage {
            Stage::Space {
                conn,
                url,
                spaces,
                panel,
                live,
            } => (
                conn.clone(),
                url.clone(),
                spaces.clone(),
                *panel,
                live.space.uuid.clone(),
            ),
            _ => return,
        };
        if resolve_space(&spaces, &id).is_some_and(|s| s.uuid == current) {
            return;
        }
        let Some(space) = open_from_rail(&spaces, &id) else {
            if let Stage::Space { live, .. } = &mut self.stage {
                live.notice_list()
                    .push(format!("No space {id} on the rail."));
            }
            return;
        };
        // The grant in progress was for the space we are leaving.
        self.drop_grant();
        match self.open_space(&conn, space, &spaces) {
            Ok(live) => {
                self.stage = Stage::Space {
                    conn,
                    url,
                    live,
                    panel,
                    spaces,
                };
            }
            Err(e) => {
                if let Stage::Space { live, .. } = &mut self.stage {
                    live.notice_list().push(e);
                }
            }
        }
    }

    fn go(&mut self, next: Next) {
        match next {
            Next::Retry => {
                self.drop_grant();
                self.flow = start_flow(&self.rt, &self.ctx, &self.args.settings);
                self.stage = Stage::Connect {
                    input: String::new(),
                };
            }
            Next::Connected(conn, url) => {
                let spaces = self.list_spaces(&conn);
                self.stage = Stage::Opening {
                    conn,
                    url,
                    spaces,
                    error: None,
                };
            }
        }
    }

    /// Drop a write-grant ask that no longer applies: the token it was
    /// for is gone, or the open space changed.
    fn drop_grant(&mut self) {
        self.grant = None;
        if let Ok(mut slot) = self.grant_slot.lock() {
            *slot = None;
        }
    }

    /// The host asked for a write grant. Start a second connect flow for
    /// that one space. The read-only flow stays until this one connects.
    fn poll_grant(&mut self) {
        if self.grant.is_some() || !matches!(self.stage, Stage::Space { .. }) {
            return;
        }
        let uuid = match self.grant_slot.lock() {
            Ok(mut slot) => slot.take(),
            Err(_) => return,
        };
        let Some(uuid) = uuid else {
            return;
        };
        let settings = self.grant_settings(&uuid);
        let flow = start_flow(&self.rt, &self.ctx, &settings);
        self.grant = Some(GrantAsk {
            space: uuid,
            flow,
            input: String::new(),
        });
    }

    /// The grant dials the executor this window already holds. An explicit
    /// URL is left alone. A discovered connect is pinned to the open one,
    /// so the grant does not search again.
    fn grant_settings(&self, space: &str) -> ConnectSettings {
        let mut settings = self.args.settings.clone();
        settings.scope = GrantScope::Write {
            space: space.to_string(),
        };
        if let Some(url) = self.connected_url() {
            we_ad4m::connect::pin_grant_url(&mut settings, &url);
        }
        settings
    }

    /// The executor the open window is connected to.
    fn connected_url(&self) -> Option<String> {
        match &self.stage {
            Stage::Opening { url, .. } | Stage::Empty { url, .. } | Stage::Space { url, .. } => {
                Some(url.clone())
            }
            Stage::Connect { .. } => None,
        }
    }

    /// The write-grant screen, over the space. A success swaps in the
    /// write token and reopens the space with it. A retry stays on this
    /// ask. Cancel, Escape, or a click outside drops the ask and leaves
    /// the read-only session. The space underneath is unchanged until a
    /// grant succeeds.
    fn draw_grant(&mut self, ui: &mut egui::Ui) {
        if self.grant.is_none() {
            return;
        }
        let mut action = None;
        if let Some(ask) = self.grant.as_mut() {
            let scope = GrantScope::Write {
                space: ask.space.clone(),
            };
            let response =
                egui::Modal::new(egui::Id::unique("we-write-grant")).show(ui.ctx(), |ui| {
                    ui.set_max_width(520.0);
                    let next = connect_screen(ui, &ask.flow, &scope, &mut ask.input);
                    match next {
                        Some(Next::Retry) => action = Some(GrantAction::Retry),
                        Some(Next::Connected(conn, url)) => {
                            action = Some(GrantAction::Granted(conn, url));
                        }
                        None => {}
                    }
                    if ui.button("Cancel").clicked() {
                        action = Some(GrantAction::Cancel);
                    }
                });
            if action.is_none() && response.should_close() {
                action = Some(GrantAction::Cancel);
            }
        }
        match action {
            Some(GrantAction::Retry) => self.restart_grant(),
            Some(GrantAction::Granted(conn, url)) => self.apply_grant(conn, url),
            Some(GrantAction::Cancel) => self.drop_grant(),
            None => {}
        }
    }

    fn restart_grant(&mut self) {
        let Some(space) = self.grant.as_ref().map(|ask| ask.space.clone()) else {
            return;
        };
        let settings = self.grant_settings(&space);
        let Some(ask) = self.grant.as_mut() else {
            return;
        };
        ask.flow = start_flow(&self.rt, &self.ctx, &settings);
        ask.input.clear();
    }

    /// The launcher approved the write grant. Watch that token from now
    /// on, and reopen the space with it. The edit that asked is not
    /// replayed.
    fn apply_grant(&mut self, conn: Connection, url: String) {
        let Some(open) = self.connected_url() else {
            self.drop_grant();
            return;
        };
        if !we_ad4m::connect::same_executor(&url, &open) {
            self.drop_grant();
            if let Stage::Space { live, .. } = &mut self.stage {
                live.notice_list().push(
                    "The write grant answered from a different executor. This window stays read-only."
                        .into(),
                );
            }
            return;
        }
        let Some(ask) = self.grant.take() else {
            return;
        };
        self.flow = ask.flow;
        self.args.access = we_ad4m::Access::write(ask.space.as_str());
        self.args.settings.scope = GrantScope::Write {
            space: ask.space.clone(),
        };
        if let Ok(mut slot) = self.grant_slot.lock() {
            *slot = None;
        }
        let (spaces, panel, current) = match &self.stage {
            Stage::Space {
                spaces,
                panel,
                live,
                ..
            } => (spaces.clone(), *panel, live.space.clone()),
            _ => return,
        };
        let space = spaces
            .iter()
            .find(|s| s.uuid == ask.space)
            .cloned()
            .unwrap_or(current);
        match self.open_space(&conn, space, &spaces) {
            Ok(live) => {
                self.stage = Stage::Space {
                    conn,
                    url,
                    live,
                    panel,
                    spaces,
                };
            }
            Err(e) => {
                if let Stage::Space { live, .. } = &mut self.stage {
                    live.notice_list().push(e);
                }
            }
        }
    }
}

enum GrantAction {
    Retry,
    Granted(Connection, String),
    Cancel,
}

enum Next {
    Retry,
    Connected(Connection, String),
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
                let (prompt, secret, field_name) = match ask {
                    Ask::CapabilityCode { request_id } => (
                        format!(
                            "This app asked for access (request {request_id}).\n\
                             {}\n\
                             Approve it in the AD4M launcher, then type the 6-digit code it shows.",
                            grant_sentence(scope)
                        ),
                        true,
                        "Approval code",
                    ),
                    Ask::Email => (
                        "This executor has accounts. Your email:".to_string(),
                        false,
                        "Email",
                    ),
                    Ask::EmailCode { email } => (
                        format!("Type the code emailed to {email}."),
                        true,
                        "Email code",
                    ),
                    Ask::Password {
                        email,
                        new_account: true,
                    } => (
                        format!("No account for {email} yet — choose a password."),
                        true,
                        "New password",
                    ),
                    Ask::Password { email, .. } => {
                        (format!("Password for {email}:"), true, "Password")
                    }
                };
                ui.label(prompt);
                if let Some(note) = note {
                    ui.colored_label(Color32::from_rgb(230, 160, 60), note);
                }
                ui.add_space(8.0);
                // The prompt sits above the field. Name the field itself: a
                // password input with no name is unreachable, and tying it
                // to the whole prompt would make that prompt's words match
                // twice.
                let field = ui
                    .add(
                        egui::TextEdit::singleline(input)
                            .password(secret)
                            .desired_width(f32::INFINITY),
                    )
                    .accessible_name(field_name);
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

/// While the perspective list is on its way, or when opening the chosen
/// space failed. Not a list to pick from.
fn opening_screen(ui: &mut egui::Ui, url: &str, error: &Option<String>) -> Option<Next> {
    let mut next = None;
    card(ui, |ui| {
        ui.label(RichText::new(format!("Connected to {url}")).weak());
        ui.add_space(8.0);
        match error {
            None => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Opening your spaces…");
                });
            }
            Some(e) => {
                ui.colored_label(Color32::from_rgb(230, 90, 90), e);
                ui.add_space(8.0);
                if ui.button("Retry").clicked() {
                    next = Some(Next::Retry);
                }
            }
        }
    });
    next
}

/// Connected, with nothing to open. Not the picker.
fn empty_screen(ui: &mut egui::Ui, url: &str, message: &str) -> Option<Next> {
    card(ui, |ui| {
        ui.label(RichText::new(format!("Connected to {url}")).weak());
        ui.add_space(8.0);
        ui.label(message);
    });
    None
}

/// What to open once the list is in. `--space` wins, matched against every
/// perspective including the system ones. Without it, the first space that
/// is not `we-root`, `we-personal` or `we-test`. A `--space` that is not
/// here opens that first space and says so.
fn landing(spaces: &[SpaceRow], want: Option<&str>) -> Landing {
    let mut agents = we_ad4m::agent_spaces(spaces).into_iter();
    if let Some(want) = want {
        if let Some(space) = resolve_space(spaces, want).cloned() {
            return Landing::Open {
                space,
                missed: None,
            };
        }
        if let Some(space) = agents.next() {
            let missed = format!(
                "--space {want:?}: no such perspective here; opened {}.",
                space.name
            );
            return Landing::Open {
                space,
                missed: Some(missed),
            };
        }
        return Landing::None {
            message: format!("--space {want:?}: no such perspective here"),
        };
    }
    match agents.next() {
        Some(space) => Landing::Open {
            space,
            missed: None,
        },
        None => Landing::None {
            message: "This agent holds no spaces yet. Make a space in WE first.".into(),
        },
    }
}

enum Landing {
    Open {
        space: SpaceRow,
        missed: Option<String>,
    },
    None {
        message: String,
    },
}

/// The space a rail click may open: one the agent holds, never a system
/// perspective. `id` is a uuid, a name, a shared URL, or the same with a
/// `neighbourhood://` prefix.
fn open_from_rail(spaces: &[SpaceRow], id: &str) -> Option<SpaceRow> {
    let space = resolve_space(spaces, id)?;
    if we_ad4m::is_system_space(&space.name) {
        return None;
    }
    Some(space.clone())
}

/// The uuid a chrome rail click names. The clicked node must sit in the
/// app chrome (`app:`). The nearest `data-we-id` must be one the host
/// allows. A space template (`space:`) and a panel (`panel:`) cannot.
fn rail_row_id(root: &ResolvedNode, clicked: &NodeId, allowed: &HashSet<String>) -> Option<String> {
    if !clicked.as_str().starts_with("app:") {
        return None;
    }
    let mut path = Vec::new();
    if !path_to(root, clicked, &mut path) {
        return None;
    }
    for node in path.iter().rev() {
        match node.props.get("data-we-id") {
            Some(Value::Str(id)) => {
                return allowed.contains(id.as_ref()).then(|| id.to_string());
            }
            Some(_) => return None,
            None => {}
        }
    }
    None
}

fn path_to<'a>(node: &'a ResolvedNode, id: &NodeId, out: &mut Vec<&'a ResolvedNode>) -> bool {
    out.push(node);
    if &node.id == id {
        return true;
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            if path_to(n, id, out) {
                return true;
            }
        }
    }
    out.pop();
    false
}

/// The id a rail click reports: a uuid, a name, a shared URL, or the same
/// with a `neighbourhood://` prefix.
fn resolve_space<'a>(spaces: &'a [SpaceRow], id: &str) -> Option<&'a SpaceRow> {
    let bare = id.strip_prefix("neighbourhood://").unwrap_or(id);
    spaces.iter().find(|s| {
        s.uuid == id
            || s.uuid == bare
            || s.name == id
            || s.shared_url.as_deref() == Some(id)
            || s.shared_url.as_deref() == Some(bare)
    })
}

/// The rail's `spaceStore.orderedSidebarItems`: one object per real space.
/// `spaceId` is the perspective uuid, which is what the route's second
/// segment is, so the open row highlights.
fn sidebar_items(spaces: &[SpaceRow]) -> we_expr::Value {
    let items: Vec<serde_json::Value> = we_ad4m::agent_spaces(spaces)
        .into_iter()
        .map(|s| {
            serde_json::json!({
                "uuid": s.uuid,
                "name": s.name,
                "spaceId": s.uuid,
            })
        })
        .collect();
    we_expr::Value::from_json(&serde_json::Value::Array(items))
}

/// Above an open screen: the socket dropped. `ad4m-client` keeps redialling;
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
            ui.label(live.access_label());
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
        .show(ui, |ui| {
            // The page's viewport is what the panels left, not the window.
            let room = ui.max_rect().size();
            live.app.frame_body_in(ui, room);
        });
    // What went wrong with a write: bottom right, where it covers neither the
    // status bar nor the inspector's header buttons, gone after eight
    // seconds unless dismissed sooner.
    let notices = live.notice_list().clone();
    notices.expire(NOTICE_LIFE);
    if !notices.list().is_empty() {
        egui::Area::new(egui::Id::unique("we-write-notices"))
            .order(egui::Order::Foreground)
            .anchor(egui::Align2::RIGHT_BOTTOM, egui::vec2(-12.0, -12.0))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str) -> SpaceRow {
        SpaceRow {
            uuid: format!("id-{name}"),
            name: name.into(),
            shared_url: None,
        }
    }

    #[test]
    fn no_request_opens_the_first_agent_space() {
        let rows = vec![row("we-root"), row("Beta"), row("Alpha")];
        match landing(&rows, None) {
            Landing::Open { space, missed } => {
                assert_eq!(space.name, "Beta");
                assert!(missed.is_none());
            }
            Landing::None { message } => panic!("{message}"),
        }
    }

    #[test]
    fn a_missing_name_opens_the_first_and_says_so() {
        let rows = vec![row("Beta")];
        match landing(&rows, Some("Nope")) {
            Landing::Open { space, missed } => {
                assert_eq!(space.name, "Beta");
                let missed = missed.expect("a miss is told");
                assert!(missed.contains("Nope"), "{missed}");
                assert!(missed.contains("Beta"), "{missed}");
            }
            Landing::None { message } => panic!("{message}"),
        }
    }

    #[test]
    fn an_explicit_system_space_still_opens() {
        let rows = vec![row("we-root"), row("Beta")];
        match landing(&rows, Some("we-root")) {
            Landing::Open { space, missed } => {
                assert_eq!(space.name, "we-root");
                assert!(missed.is_none());
            }
            Landing::None { message } => panic!("{message}"),
        }
    }

    #[test]
    fn only_system_spaces_leave_the_window_empty() {
        let rows = vec![row("we-root"), row("we-personal"), row("we-test")];
        assert!(matches!(landing(&rows, None), Landing::None { .. }));
    }

    #[test]
    fn the_sidebar_skips_system_spaces() {
        let text = format!("{:?}", sidebar_items(&[row("we-root"), row("Beta")]));
        assert!(text.contains("Beta"), "{text}");
        assert!(!text.contains("we-root"), "{text}");
    }

    fn node(id: &str, we_id: Option<&str>, children: Vec<ResolvedNode>) -> ResolvedNode {
        let mut props = indexmap::IndexMap::new();
        if let Some(we_id) = we_id {
            props.insert(
                std::sync::Arc::<str>::from("data-we-id"),
                Value::from(we_id),
            );
        }
        ResolvedNode {
            id: id.into(),
            ty: std::sync::Arc::from("div"),
            props,
            handlers: Default::default(),
            slot: None,
            children: children
                .into_iter()
                .map(|n| ResolvedChild::Node(Box::new(n)))
                .collect(),
            surfaces: Default::default(),
            transition: None,
        }
    }

    fn allowed(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn a_chrome_row_click_names_an_allowed_space() {
        let row = node(
            "app:row",
            Some("id-beta"),
            vec![node("app:row/btn", None, vec![])],
        );
        let id = rail_row_id(&row, &"app:row/btn".into(), &allowed(&["id-beta"]));
        assert_eq!(id.as_deref(), Some("id-beta"));
    }

    #[test]
    fn a_space_template_click_cannot_name_a_rail_row() {
        let row = node(
            "space:row",
            Some("id-beta"),
            vec![node("space:row/btn", None, vec![])],
        );
        assert!(rail_row_id(&row, &"space:row/btn".into(), &allowed(&["id-beta"])).is_none());
    }

    #[test]
    fn a_system_uuid_on_a_chrome_row_is_not_a_rail_click() {
        let row = node(
            "app:row",
            Some("id-we-root"),
            vec![node("app:row/btn", None, vec![])],
        );
        assert!(rail_row_id(&row, &"app:row/btn".into(), &allowed(&["id-beta"])).is_none());
    }

    #[test]
    fn a_panel_click_cannot_name_a_rail_row() {
        let row = node(
            "panel:inspector",
            Some("id-beta"),
            vec![node("panel:inspector/btn", None, vec![])],
        );
        assert!(rail_row_id(&row, &"panel:inspector/btn".into(), &allowed(&["id-beta"])).is_none());
    }

    #[test]
    fn the_rail_does_not_open_a_system_space() {
        let rows = vec![row("we-root"), row("Beta"), row("we-custom")];
        assert!(open_from_rail(&rows, "id-we-root").is_none());
        assert!(open_from_rail(&rows, "we-root").is_none());
        assert_eq!(open_from_rail(&rows, "id-Beta").unwrap().name, "Beta");
        assert_eq!(
            open_from_rail(&rows, "we-custom").unwrap().name,
            "we-custom"
        );
    }
}
