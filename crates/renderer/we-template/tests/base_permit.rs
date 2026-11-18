//! Base-store calls run only with a permit the gate issued for the built-in
//! base mount.

use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    Action, ActionRequest, AppSpec, BasePermitFacts, BundleTemplate, Completer, Host, Invoked,
    LocalState, NodeId, ResolvedChild, ResolvedNode, RootSpec, Runtime, SchemaNode, StoreBag,
};

struct CountHost {
    ran: Vec<String>,
}

impl Host for CountHost {
    fn act(&mut self, request: ActionRequest, _done: Completer) -> Invoked {
        let Action::Invoke { target, args } = &request.action;
        if let Some(permit) = &request.permit {
            if permit.matches(target, args) && target.as_ref() == "baseStore.choose" {
                self.ran.push(target.to_string());
            }
        }
        Invoked::Done(Ok(Value::Undefined))
    }
}

fn facts(busy: bool) -> BasePermitFacts {
    BasePermitFacts {
        builtin: "coasys".into(),
        generation: 1,
        catalog: vec!["this-device".into()],
        busy,
    }
}

fn button(invoke: serde_json::Value) -> SchemaNode {
    serde_json::from_value(json!({
        "type": "we-button",
        "children": ["go"],
        "props": { "onClick": invoke }
    }))
    .unwrap()
}

fn choose(id: &str) -> serde_json::Value {
    json!({ "$invoke": "baseStore.choose", "args": [id] })
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

fn find_button(node: &ResolvedNode) -> NodeId {
    fn walk(node: &ResolvedNode) -> Option<NodeId> {
        if node.ty.as_ref() == "we-button" {
            return Some(node.id.clone());
        }
        for child in &node.children {
            if let ResolvedChild::Node(next) = child {
                if let Some(id) = walk(next) {
                    return Some(id);
                }
            }
        }
        None
    }
    walk(node).expect("the button is in the tree")
}

fn dispatch(spec: RootSpec, invoke_busy: bool) -> (Vec<String>, usize) {
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::from_spec(spec, bag, LocalState::new());
    rt.set_base_facts(Some(facts(invoke_busy)));
    let mut host = CountHost { ran: Vec::new() };
    let mut screen = screen();
    let root = rt.frame(&mut host, &screen).clone();
    let before = rt.gate().denial_count();
    let id = find_button(&root);
    rt.dispatch(&mut host, &mut screen, &id, "onClick", Value::Null);
    let denials = rt.gate().denial_count() - before;
    (host.ran, denials)
}

#[test]
fn a_built_in_base_choose_schedules_one_call() {
    let (ran, denials) = dispatch(
        RootSpec::base(button(choose("this-device")), "coasys"),
        false,
    );
    assert_eq!(ran, vec!["baseStore.choose".to_string()]);
    assert_eq!(denials, 0);
}

#[test]
fn an_explicit_space_mount_choose_does_not_run() {
    let (ran, denials) = dispatch(
        RootSpec::single(button(choose("this-device")), "test"),
        false,
    );
    assert!(ran.is_empty());
    assert!(denials >= 1);
}

#[test]
fn an_app_slot_choose_does_not_run() {
    let app: BundleTemplate = serde_json::from_value(json!({
        "id": "shell",
        "meta": { "role": "app" },
        "type": "we-button",
        "children": ["go"],
        "props": { "onClick": { "$invoke": "baseStore.choose", "args": ["this-device"] } }
    }))
    .unwrap();
    let spec = RootSpec::App(Box::new(AppSpec {
        bundle: "coasys".into(),
        app: Some(app),
        template: None,
        pages: Vec::new(),
        boot: None,
    }));
    let (ran, denials) = dispatch(spec, false);
    assert!(ran.is_empty());
    assert!(denials >= 1);
}

#[test]
fn an_unknown_id_and_extra_args_do_not_run() {
    let (ran, denials) = dispatch(RootSpec::base(button(choose("nope")), "coasys"), false);
    assert!(ran.is_empty());
    assert!(denials >= 1);

    let invoke = json!({ "$invoke": "baseStore.submitPassword", "args": ["hunter2"] });
    let (ran, denials) = dispatch(RootSpec::base(button(invoke), "coasys"), false);
    assert!(ran.is_empty(), "extra arguments must not run");
    assert!(denials >= 1);
}

#[test]
fn a_busy_choose_does_not_run() {
    let (ran, denials) = dispatch(
        RootSpec::base(button(choose("this-device")), "coasys"),
        true,
    );
    assert!(ran.is_empty());
    assert!(denials >= 1);
}

#[test]
fn a_base_call_without_facts_does_not_use_a_snapshot_reply() {
    let bag = StoreBag::from_snapshot(&json!({
        "stores": {},
        "queries": {},
        "invokes": { "baseStore.choose": "ran" }
    }))
    .unwrap();
    let bag = Arc::new(bag);
    let mut rt = Runtime::from_spec(
        RootSpec::base(button(choose("this-device")), "coasys"),
        bag.clone(),
        LocalState::new(),
    );
    let mut host = we_template::StaticHost::new(bag);
    let mut screen = screen();
    let root = rt.frame(&mut host, &screen).clone();
    let before = rt.gate().denial_count();
    rt.dispatch(
        &mut host,
        &mut screen,
        &find_button(&root),
        "onClick",
        Value::Null,
    );
    assert_eq!(rt.gate().denial_count(), before, "no facts, no denial");
    assert!(
        host.dropped.iter().any(|t| t == "baseStore.choose"),
        "the snapshot reply did not run"
    );
}
