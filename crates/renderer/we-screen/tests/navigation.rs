//! `navigation.json` — the C1 navigation scripts, replayed on
//! `MemoryHistory`. Each case's `start` mounts a `Navigator`; every step is
//! the op the recorder called, and after it the script's `expect` row is
//! checked: `href`, `pageIdentity`, `depth`, `index`, and `resolved` for
//! `local_read`. Loaded from the conformance package at test time, so a
//! re-recorded vector is picked up without a code change.
use indexmap::IndexMap;
use serde_json::{json, Value as Json};
use we_expr::Value;
use we_screen::{
    js_json_stringify, local_persist_key, local_write_mirror, plain_value, resolve_local_initial,
    MemoryHistory, MemoryPrefs, NavigateOptions, Navigator, PrefStore, ScreenSchema,
};

const VECTOR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/schema-system/conformance/vectors/navigation.json"
);

#[test]
fn navigation_vectors() {
    let text = std::fs::read_to_string(VECTOR).expect("navigation.json should be readable");
    let vector: Json = serde_json::from_str(&text).expect("navigation.json should parse");
    let cases = vector["cases"].as_array().expect("vector has cases");
    assert!(!cases.is_empty(), "navigation.json should hold cases");

    for case in cases {
        let id = case["id"].as_str().unwrap_or("?");
        let schema = ScreenSchema::from_json(&case["schema"]);
        let start = case["start"].as_str().expect("case has a start");
        let mut nav = Navigator::new(schema, Box::new(MemoryHistory::new(start)));
        let mut prefs = MemoryPrefs::default();
        let steps = case["steps"].as_array().expect("case has steps");
        let expect = case["expect"].as_array().expect("case has expect");

        assert_eq!(
            steps.len(),
            expect.len(),
            "{id}: steps and expect rows must pair up"
        );
        for (i, (step, exp)) in steps.iter().zip(expect).enumerate() {
            let mut resolved: Option<Value> = None;
            run_step(step, &mut nav, &mut prefs, &mut resolved);
            check(id, i, exp, &nav);
            if let Some(expected) = exp.get("resolved") {
                let got = resolved
                    .as_ref()
                    .and_then(js_json_stringify)
                    .unwrap_or_default();
                let want = serde_json::to_string(expected).unwrap_or_default();
                assert_eq!(got, want, "{id}[{i}] resolved");
            }
        }
    }
}

fn run_step(
    step: &Json,
    nav: &mut Navigator,
    prefs: &mut MemoryPrefs,
    resolved: &mut Option<Value>,
) {
    let args = &step["args"];
    match step["op"].as_str().unwrap_or_default() {
        "navigate" => {
            let options = &args["options"];
            let query = options["query"].as_object().map(|q| {
                q.iter()
                    .map(|(k, v)| (k.clone(), plain_value(v)))
                    .collect::<IndexMap<String, Value>>()
            });
            nav.navigate(
                args["to"].as_str().expect("navigate.to"),
                NavigateOptions {
                    query,
                    base_depth: options["base"]["depth"].as_u64().map(|d| d as usize),
                    replace: options["replace"].as_bool().unwrap_or(false),
                },
            );
        }
        // The recorder's setParam passes `push: args.push === true` — the
        // declared `push` default is an op-level concept, not the
        // routeStore call's.
        "set_param" => {
            nav.set_param(
                args["name"].as_str().expect("set_param.name"),
                args["value"].as_str(),
                args["push"].as_bool().unwrap_or(false),
            );
        }
        "back" => {
            nav.back();
        }
        "forward" => {
            nav.forward();
        }
        "open" => {
            nav.open(args["href"].as_str().expect("open.href"));
        }
        // rule 9: the syncParam write mirror — persist goes to storage, the
        // param write goes to set_param with the spec's push.
        "sync_param" => {
            let name = args["name"].as_str().expect("sync_param.name");
            let field_type = args["type"].as_str().expect("sync_param.type");
            let value = plain_value(&args["value"]);
            let initial = plain_value(&args["initial"]);
            let spec = json!({
                "name": name,
                "push": args["push"].as_bool().unwrap_or(false),
            });
            let mirror = local_write_mirror(
                field_type,
                args["persist"].as_str(),
                &spec,
                &value,
                &initial,
            );
            if let Some((key, text)) = mirror.store {
                prefs.set(&key, Some(&text));
            }
            if let Some(param) = mirror.param {
                nav.set_param(&param.name, param.text.as_deref(), param.push);
            }
        }
        // The mount-time initial — resolved here, compared by the caller
        // against `expect.resolved`.
        "local_read" => {
            let name = args["name"].as_str().expect("local_read.name");
            let field_type = args["type"].as_str().expect("local_read.type");
            let persist = args["persist"].as_str();
            let stored = local_persist_key(field_type, persist).and_then(|key| prefs.get(&key));
            *resolved = Some(resolve_local_initial(
                field_type,
                persist,
                &json!({ "name": name }),
                &plain_value(&args["initial"]),
                stored.as_deref(),
                nav.param(name),
            ));
        }
        other => panic!("unknown op {other:?}"),
    }
}

fn check(id: &str, i: usize, exp: &Json, nav: &Navigator) {
    assert_eq!(nav.href(), exp["href"].as_str().unwrap(), "{id}[{i}] href");
    assert_eq!(
        nav.page_identity(),
        exp["pageIdentity"].as_str().unwrap(),
        "{id}[{i}] pageIdentity"
    );
    assert_eq!(
        nav.depth(),
        exp["depth"].as_u64().unwrap() as usize,
        "{id}[{i}] depth"
    );
    assert_eq!(
        nav.index(),
        exp["index"].as_u64().unwrap() as usize,
        "{id}[{i}] index"
    );
}
