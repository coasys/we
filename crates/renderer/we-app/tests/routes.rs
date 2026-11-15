//! The bundle's app root across routes: chrome + space template (lanes,
//! `$routes` outlet), the `/record/:entity` host route, pages, the landing —
//! every mount must resolve without panicking and without `$todo` stubs for
//! the ops the stage implements.

use std::sync::Arc;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, Bundle, LocalState, ResolvedChild, ResolvedNode, Runtime, StaticHost, StoreBag,
};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("data/tree-snapshot.json");

fn rig(route: &str) -> (Runtime, StaticHost, ScreenState) {
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let json: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    let bag = Arc::new(StoreBag::from_snapshot(&json).unwrap());
    let locals = LocalState::new();
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let rt = Runtime::app(spec, Arc::clone(&bag), locals.clone());
    // A raw `Runtime` gets no adapter — a session installs one in its
    // constructor. `routeStore.params` is a screen fact the snapshot never
    // stores; without the faces it reads `Undefined` here.
    let _bindings = we_legacy::LegacyBindings::install(rt.layer(), rt.view());
    let host = StaticHost::new(bag);
    let screen = ScreenState::desktop(
        ScreenSchema {
            pages: bundle
                .pages
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            ..ScreenSchema::default()
        },
        route,
    );
    (rt, host, screen)
}

fn count(n: &ResolvedNode) -> usize {
    1 + n
        .children
        .iter()
        .map(|c| match c {
            ResolvedChild::Node(x) => count(x),
            _ => 0,
        })
        .sum::<usize>()
}

fn count_ty(n: &ResolvedNode, ty: &str) -> usize {
    (n.ty.as_ref() == ty) as usize
        + n.children
            .iter()
            .map(|c| match c {
                ResolvedChild::Node(x) => count_ty(x, ty),
                _ => 0,
            })
            .sum::<usize>()
}

#[test]
fn every_route_resolves() {
    for route in [
        "/",
        "/about",
        "/space/demo",
        "/space/demo/workflows",
        "/space/demo/channels",
        "/space/demo/calls",
        "/space/demo/people",
        "/space/demo/dna",
        "/space/demo/person",
        "/space/demo?view=canvas",
        "/space/demo?id=inspector",
        "/record/TaskBlock",
        "/no/such/route",
    ] {
        let (mut rt, mut host, screen) = rig(route);
        let root = rt.frame(&mut host, &screen).clone();
        assert!(
            count(&root) > 0,
            "{route}: resolved nothing (warnings: {:?})",
            rt.stats().warnings
        );
        assert_eq!(
            rt.stats().parse_errors,
            0,
            "{route}: parse errors {:?}",
            rt.stats().warnings
        );
    }
}

#[test]
fn space_route_mounts_template_and_lanes() {
    let (mut rt, mut host, screen) = rig("/space/demo?view=canvas");
    let root = rt.frame(&mut host, &screen).clone();
    // The template's two `$panels` lanes land; the space tree renders inside
    // the first.
    assert_eq!(count_ty(&root, "$lane"), 2, "lanes missing");
    assert_eq!(count_ty(&root, "we-tree"), 1, "tree panel missing");
    // The chrome mounts beside the template — the rail never leaves.
    assert_eq!(count_ty(&root, "AgentChatSheet"), 1, "chrome missing");
}

#[test]
fn record_route_resolves_record_surface() {
    let (mut rt, mut host, screen) = rig("/record/TaskBlock");
    let root = rt.frame(&mut host, &screen).clone();
    // `recordViews` has no inline schema for TaskBlock — the honest
    // placeholder, not silence.
    assert_eq!(count_ty(&root, "$record"), 1);
}

#[test]
fn star_route_redirects_to_space_root() {
    let (mut rt, mut host, screen) = rig("/space/demo/bogus");
    rt.frame(&mut host, &screen);
    let ops = rt.take_ops();
    assert!(
        ops.iter()
            .any(|op| matches!(op, we_screen::ScreenOp::Navigate { replace: true, .. })),
        "`*` route should queue a replace-navigate; got {ops:?}"
    );
}

/// Lal U1 × the app frame: the chrome's host surface is the slot the
/// frontend paints the session into; the mounts the content viewport
/// frames carry their host tags on that synthetic `frame` node — sized off
/// `meta.frame` and the viewport, never off the template. No template
/// node carries a host tag.
#[test]
fn host_surfaces_sit_on_mount_boundaries() {
    fn hosts(n: &ResolvedNode, out: &mut Vec<(String, we_template::SurfaceTag)>) {
        for t in &n.surfaces {
            if matches!(t.key, we_template::SurfaceKey::Host(_)) {
                out.push((n.id.to_string(), t.clone()));
            }
        }
        for c in &n.children {
            if let ResolvedChild::Node(x) = c {
                hosts(x, out);
            }
        }
    }
    let (mut rt, mut host, screen) = rig("/space/demo");
    let root = rt.frame(&mut host, &screen).clone();
    assert_eq!(
        rt.host_surfaces()
            .iter()
            .map(|t| t.key.clone())
            .collect::<Vec<_>>(),
        vec![we_template::SurfaceKey::Host("app".into())],
        "the chrome's boundary is the slot"
    );
    let mut on_nodes = Vec::new();
    hosts(&root, &mut on_nodes);
    assert!(
        !on_nodes.is_empty(),
        "the framed mounts claim host surfaces"
    );
    for (id, tag) in &on_nodes {
        assert_eq!(id, "frame", "{tag:?} sits on the content viewport only");
    }
}
