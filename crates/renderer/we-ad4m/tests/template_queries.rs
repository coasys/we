//! Level-2 conformance: the 17 template query cases
//! (`packages/backend-system/conformance/src/templateQueries.ts`) from Rust,
//! against a real executor (`EXECUTOR_PATH`; skipped without it).
//!
//! Each case is the same `$query` the TS suite lifts from a shipped template,
//! sent the way the Rust app sends it — [`we_ad4m::translate::model_query`],
//! then `perspective.modelQuery` — over the same fixture space, with the same
//! expected answers. AD4M's known gaps (`ad4m/tests/live/conformance.live.ts`)
//! run inverted, as `it.fails` does there: a gap that starts passing fails
//! here, so it is noticed and taken off the list.
//!
//! One difference from the TS suite, written down rather than hidden: the
//! classes are WE-shaped SHACL written by hand (WE's own are generated at
//! runtime by the TS SDK's decorators, and no JSON of them exists to load),
//! and the space is seeded as links, because the executor these tests run
//! against may predate the validated write RPC. The predicates are WE's.
use std::collections::BTreeMap;
use std::time::Duration;

use ad4m_client::model::Model;
use serde_json::{json, Value};
use we_ad4m::testkit as kit;
use we_ad4m::{Connection, Relations, Runtime};
use we_template::QueryIr;

/// WE's classes, cut to what the cases read. Untyped relations
/// (`children`, `responses`, `thread`) carry no target, so their members
/// hydrate as whatever they are; `respondsTo` is `responses` read backwards.
const CLASSES: &[(&str, &str)] = &[
    (
        "CollectionBlock",
        r#"{"target_class":"we://CollectionBlock",
  "constructor_actions":[{"action":"addLink","source":"this","predicate":"we://kind","target":"placeholder"}],
  "properties":[
    {"path":"we://kind","name":"kind","min_count":1,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://kind","target":"value"}]},
    {"path":"we://title","name":"title","min_count":0,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://title","target":"value"}]},
    {"path":"we://text_content","name":"textContent","min_count":0,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://text_content","target":"value"}]},
    {"path":"ad4m://has_child","name":"children","relation_kind":"hasMany"},
    {"path":"we://response","name":"responses","relation_kind":"hasMany"},
    {"path":"we://thread","name":"thread","relation_kind":"hasMany"},
    {"path":"we://signal","name":"signals","relation_kind":"hasMany","target_class_name":"Signal"},
    {"path":"we://response","name":"respondsTo","relation_kind":"belongsToOne"}
  ]}"#,
    ),
    (
        "TextBlock",
        r#"{"target_class":"we://TextBlock",
  "constructor_actions":[{"action":"addLink","source":"this","predicate":"we://text","target":"placeholder"}],
  "properties":[
    {"path":"we://text","name":"text","min_count":1,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://text","target":"value"}]},
    {"path":"we://response","name":"responses","relation_kind":"hasMany"},
    {"path":"we://thread","name":"thread","relation_kind":"hasMany"},
    {"path":"we://response","name":"respondsTo","relation_kind":"belongsToOne"}
  ]}"#,
    ),
    (
        "LinkBlock",
        r#"{"target_class":"we://LinkBlock",
  "constructor_actions":[{"action":"addLink","source":"this","predicate":"we://url","target":"placeholder"}],
  "properties":[
    {"path":"we://url","name":"url","min_count":1,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://url","target":"value"}]},
    {"path":"we://title","name":"title","min_count":0,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://title","target":"value"}]}
  ]}"#,
    ),
    (
        "TaskBlock",
        r#"{"target_class":"we://TaskBlock",
  "constructor_actions":[{"action":"addLink","source":"this","predicate":"we://status","target":"placeholder"}],
  "properties":[
    {"path":"we://status","name":"status","min_count":1,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://status","target":"value"}]},
    {"path":"we://title","name":"title","min_count":0,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://title","target":"value"}]}
  ]}"#,
    ),
    (
        "Signal",
        r#"{"target_class":"we://Signal",
  "constructor_actions":[{"action":"addLink","source":"this","predicate":"we://signal_type_id","target":"placeholder"}],
  "properties":[
    {"path":"we://signal_type_id","name":"signalTypeId","min_count":1,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://signal_type_id","target":"value"}]}
  ]}"#,
    ),
    (
        "RelationshipType",
        r#"{"target_class":"we://RelationshipType",
  "constructor_actions":[{"action":"addLink","source":"this","predicate":"we://name","target":"placeholder"}],
  "properties":[
    {"path":"we://name","name":"name","min_count":1,"max_count":1,"setter":[{"action":"setSingleTarget","source":"this","predicate":"we://name","target":"value"}]}
  ]}"#,
    ),
];

/// The fixture space's records: key → (id, its scalar links).
struct Space {
    ids: BTreeMap<&'static str, String>,
}

impl Space {
    fn id(&self, key: &str) -> &str {
        &self.ids[key]
    }
    fn key_of(&self, id: &str) -> String {
        self.ids
            .iter()
            .find(|(_, v)| v.as_str() == id)
            .map(|(k, _)| k.to_string())
            .unwrap_or_else(|| format!("unknown:{id}"))
    }
}

/// The space `templateQueries.ts` seeds, in the same order (`createdAt`
/// ordering depends on it), as links.
fn seed(rt: &Runtime, conn: &Connection, uuid: &str) -> Space {
    let mut ids = BTreeMap::new();
    let mut make = |key: &'static str, fields: &[(&str, &str)]| {
        let id = format!("e7q://{key}");
        let links: Vec<(&str, String)> =
            fields.iter().map(|(p, v)| (*p, kit::literal(v))).collect();
        kit::add_links(rt, conn, uuid, &id, &links);
        // Distinct createdAt for every record.
        std::thread::sleep(Duration::from_millis(25));
        ids.insert(key, id);
    };
    let link = |from: &str, predicate: &str, to: &str| {
        kit::add_links(
            rt,
            conn,
            uuid,
            &format!("e7q://{from}"),
            &[(predicate, format!("e7q://{to}"))],
        );
    };
    let child = |p: &str, c: &str| link(p, "ad4m://has_child", c);

    make(
        "channel",
        &[("we://kind", "channel"), ("we://title", "General")],
    );
    for (key, text) in [
        ("post1", "hello world"),
        ("post2", "hello again"),
        ("post3", "hello there"),
    ] {
        make(key, &[("we://kind", "post"), ("we://text_content", text)]);
        child("channel", key);
    }
    link("post2", "we://response", "post3");
    for key in ["text1", "text2"] {
        make(key, &[("we://text", key)]);
        child("post1", key);
    }
    make(
        "link1",
        &[("we://url", "https://example.org"), ("we://title", "link1")],
    );
    child("post1", "link1");
    make(
        "comment1",
        &[("we://kind", "reply"), ("we://text_content", "a reply")],
    );
    link("post1", "we://response", "comment1");
    make(
        "comment2",
        &[("we://kind", "reply"), ("we://text_content", "and another")],
    );
    link("comment1", "we://response", "comment2");
    make(
        "callAbout",
        &[("we://kind", "call"), ("we://title", "About this")],
    );
    link("post1", "we://response", "callAbout");
    for key in ["comment1", "comment2", "callAbout"] {
        link("post1", "we://thread", key);
    }
    for (i, post) in ["post1", "post1", "post2"].iter().enumerate() {
        let key: &'static str = ["sig1", "sig2", "sig3"][i];
        make(key, &[("we://signal_type_id", "like")]);
        link(post, "we://signal", key);
    }
    make("call", &[("we://kind", "call"), ("we://title", "Standup")]);
    child("channel", "call");
    make("line1", &[("we://text", "lunch at 1?")]);
    child("call", "line1");
    make("lineReply", &[("we://text", "yes")]);
    link("line1", "we://response", "lineReply");
    link("line1", "we://thread", "lineReply");
    make("board", &[("we://kind", "board"), ("we://title", "Work")]);
    child("channel", "board");
    for key in ["column1", "column2"] {
        make(key, &[("we://kind", "column"), ("we://title", key)]);
        child("board", key);
    }
    for key in ["task1", "task2"] {
        make(key, &[("we://status", "todo"), ("we://title", key)]);
        child("channel", key);
    }
    make("canvas", &[("we://kind", "canvas"), ("we://title", "Map")]);
    for key in ["beta", "alpha", "gamma"] {
        make(key, &[("we://name", key)]);
    }
    Space { ids }
}

/// What a case must answer, as in the TS suite.
enum Expect {
    Order(&'static [&'static str]),
    Set(&'static [&'static str]),
    /// One number per row: an array's length, else the value.
    Field(&'static str, &'static [(&'static str, u64)]),
    /// The record a relation points at, per row.
    Points(&'static str, &'static [(&'static str, &'static str)]),
    /// Two relations' targets per row.
    Ends(
        [&'static str; 2],
        &'static [(&'static str, [&'static str; 2])],
    ),
}

struct Case {
    id: &'static str,
    entity: &'static str,
    /// The query, `{key}` standing for a record's id and `{agent}` for me.
    query: Value,
    expect: Expect,
    /// AD4M's documented gap, when it has one: run inverted.
    gap: Option<Gap>,
}

fn in_channel() -> Value {
    json!({ "anchor": "CollectionBlock", "via": "children", "anchorId": "{channel}" })
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            id: "vocabulary-by-name",
            entity: "RelationshipType",
            query: json!({ "order": { "name": "asc" } }),
            expect: Expect::Order(&["alpha", "beta", "gamma"]),
            gap: None,
        },
        Case {
            id: "blocks-of-a-post",
            entity: "TextBlock",
            query: json!({ "scope": { "anchor": "CollectionBlock", "via": "children", "anchorId": "{post1}" },
                           "order": { "createdAt": "asc" }, "limit": 20 }),
            expect: Expect::Order(&["text1", "text2"]),
            gap: None,
        },
        Case {
            id: "links-of-a-post",
            entity: "LinkBlock",
            query: json!({ "scope": { "anchor": "CollectionBlock", "via": "children", "anchorId": "{post1}" },
                           "order": { "createdAt": "desc" }, "limit": 20 }),
            expect: Expect::Order(&["link1"]),
            gap: None,
        },
        Case {
            id: "calls-in-a-channel",
            entity: "CollectionBlock",
            query: json!({ "where": { "kind": "call" }, "scope": in_channel(), "limit": 20, "order": { "createdAt": "desc" } }),
            expect: Expect::Order(&["call"]),
            gap: None,
        },
        Case {
            id: "posts-newest-first",
            entity: "CollectionBlock",
            query: json!({ "where": { "kind": "post", "respondsTo": { "none": {} }, "textContent": { "contains": "hello" } },
                           "scope": in_channel(), "limit": 20, "order": { "createdAt": "desc" } }),
            expect: Expect::Order(&["post2", "post1"]),
            gap: None,
        },
        Case {
            id: "posts-most-liked",
            entity: "CollectionBlock",
            query: json!({ "where": { "kind": "post", "respondsTo": { "none": {} } }, "scope": in_channel(),
                           "limit": 20, "order": { "$likeCount": "desc" },
                           "include": { "$likeCount": { "from": "signals", "count": true } } }),
            expect: Expect::Field("$likeCount", &[("post1", 2), ("post2", 1)]),
            gap: None,
        },
        Case {
            id: "discussion-root",
            entity: "CollectionBlock",
            query: json!({ "where": { "id": "{post1}" }, "include": { "signals": true }, "limit": 1 }),
            expect: Expect::Field("signals", &[("post1", 2)]),
            gap: None,
        },
        Case {
            id: "comment-thread",
            entity: "CollectionBlock",
            query: json!({ "where": { "author": { "not": ["did:test:somebody-muted"] } },
                           "scope": { "anchor": "CollectionBlock", "via": "responses", "anchorId": "{post1}", "levels": [10, 5, 3] },
                           "order": { "createdAt": "asc" }, "include": { "respondsTo": true } }),
            expect: Expect::Points("respondsTo", &[("comment1", "post1"), ("comment2", "comment1"), ("callAbout", "post1")]),
            gap: None,
        },
        Case {
            id: "comment-thread-muted",
            entity: "CollectionBlock",
            query: json!({ "where": { "author": { "not": ["{agent}"] } },
                           "scope": { "anchor": "CollectionBlock", "via": "responses", "anchorId": "{post1}", "levels": [10, 5, 3] },
                           "order": { "createdAt": "asc" } }),
            expect: Expect::Order(&[]),
            gap: None,
        },
        Case {
            id: "reply-total-leaves-calls-out",
            entity: "CollectionBlock",
            query: json!({ "where": { "id": "{post1}" }, "limit": 1,
                           "include": { "$replyCount": { "from": "thread", "count": true, "where": { "kind": "reply" } } } }),
            expect: Expect::Field("$replyCount", &[("post1", 2)]),
            gap: Some(Gap {
                why: "a count's where on an untyped relation is skipped (build_projection_where_patterns)",
                // Every response counted: two replies and the call.
                shape: GapShape::Counts(3),
            }),
        },
        Case {
            id: "newest-in-a-channel",
            entity: "CollectionBlock",
            query: json!({ "where": { "id": "{channel}" }, "limit": 1, "include": {
                "$firstChild": { "from": "children", "order": { "createdAt": "ASC" }, "limit": 1 },
                "$latestChild": { "from": "children", "order": { "createdAt": "DESC" }, "limit": 1 } } }),
            expect: Expect::Ends(["$firstChild", "$latestChild"], &[("channel", ["post1", "task2"])]),
            gap: Some(Gap {
                why: "a projection's order honours only id/base (build_projection_order_clause)",
                shape: GapShape::SameMemberBothEnds,
            }),
        },
        Case {
            id: "newest-reply-under-a-post",
            entity: "CollectionBlock",
            query: json!({ "where": { "id": "{post1}" }, "limit": 1, "include": {
                "$firstReply": { "from": "thread", "order": { "createdAt": "ASC" }, "limit": 1 },
                "$latestReply": { "from": "thread", "order": { "createdAt": "DESC" }, "limit": 1 } } }),
            expect: Expect::Ends(["$firstReply", "$latestReply"], &[("post1", ["comment1", "callAbout"])]),
            gap: Some(Gap {
                why: "a projection's order honours only id/base (build_projection_order_clause)",
                shape: GapShape::SameMemberBothEnds,
            }),
        },
        Case {
            id: "transcript-lines-with-replies",
            entity: "TextBlock",
            query: json!({ "scope": { "anchor": "CollectionBlock", "via": "children", "anchorId": "{call}" },
                           "order": { "createdAt": "desc" }, "limit": 50, "include": { "thread": true } }),
            expect: Expect::Field("thread", &[("line1", 1)]),
            gap: None,
        },
        Case {
            id: "boards-in-a-channel",
            entity: "CollectionBlock",
            query: json!({ "where": { "kind": "board" }, "scope": in_channel(), "order": { "createdAt": "asc" }, "limit": 50 }),
            expect: Expect::Order(&["board"]),
            gap: None,
        },
        Case {
            id: "columns-of-a-board",
            entity: "CollectionBlock",
            query: json!({ "where": { "kind": "column" },
                           "scope": { "anchor": "CollectionBlock", "via": "children", "anchorId": "{board}" } }),
            expect: Expect::Set(&["column1", "column2"]),
            gap: None,
        },
        Case {
            id: "tasks-in-a-channel",
            entity: "TaskBlock",
            query: json!({ "scope": in_channel(), "order": { "createdAt": "asc" } }),
            expect: Expect::Order(&["task1", "task2"]),
            gap: None,
        },
        Case {
            id: "canvases",
            entity: "CollectionBlock",
            query: json!({ "where": { "kind": "canvas" }, "order": { "createdAt": "asc" } }),
            expect: Expect::Order(&["canvas"]),
            gap: None,
        },
    ]
}

/// `{key}` → the record's id, `{agent}` → me, everywhere in the query.
fn fill(v: &Value, space: &Space, agent: &str) -> Value {
    match v {
        Value::String(s) if s.starts_with('{') && s.ends_with('}') => {
            let key = &s[1..s.len() - 1];
            if key == "agent" {
                Value::from(agent)
            } else {
                Value::from(space.id(key))
            }
        }
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, space, agent)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), fill(x, space, agent)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn id_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(o) => o.get("id").and_then(Value::as_str).map(str::to_string),
        Value::Array(a) => a.first().and_then(id_of),
        _ => None,
    }
}

/// The answer in the expectation's own terms, and what it should be.
fn compare(rows: &[Value], expect: &Expect, space: &Space) -> (Value, Value) {
    let key = |r: &Value| space.key_of(r["id"].as_str().unwrap_or_default());
    match expect {
        Expect::Order(want) => (json!(rows.iter().map(key).collect::<Vec<_>>()), json!(want)),
        Expect::Set(want) => {
            let mut got: Vec<String> = rows.iter().map(key).collect();
            got.sort();
            let mut want: Vec<&str> = want.to_vec();
            want.sort();
            (json!(got), json!(want))
        }
        Expect::Field(field, want) => {
            let got: BTreeMap<String, u64> = rows
                .iter()
                .map(|r| {
                    let n = match &r[*field] {
                        Value::Array(a) => a.len() as u64,
                        Value::Number(n) => n.as_u64().unwrap_or(0),
                        _ => 0,
                    };
                    (key(r), n)
                })
                .collect();
            let want: BTreeMap<String, u64> =
                want.iter().map(|(k, n)| (k.to_string(), *n)).collect();
            (json!(got), json!(want))
        }
        Expect::Points(rel, want) => {
            let got: BTreeMap<String, Value> = rows
                .iter()
                .map(|r| (key(r), json!(id_of(&r[*rel]).map(|id| space.key_of(&id)))))
                .collect();
            let want: BTreeMap<String, Value> = want
                .iter()
                .map(|(k, t)| (k.to_string(), json!(t)))
                .collect();
            (json!(got), json!(want))
        }
        Expect::Ends(rels, want) => {
            let got: BTreeMap<String, Value> = rows
                .iter()
                .map(|r| {
                    let ends: Vec<Value> = rels
                        .iter()
                        .map(|rel| json!(id_of(&r[*rel]).map(|id| space.key_of(&id))))
                        .collect();
                    (key(r), json!(ends))
                })
                .collect();
            let want: BTreeMap<String, Value> = want
                .iter()
                .map(|(k, t)| (k.to_string(), json!(t)))
                .collect();
            (json!(got), json!(want))
        }
    }
}

#[test]
fn the_seventeen_template_queries() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = Runtime::new().unwrap();
    let conn = kit::connect(&rt, &executor.url);
    let uuid = kit::new_space(&rt, &conn, "e7-level2");
    for (name, shacl) in CLASSES {
        kit::add_class(&rt, &conn, &uuid, name, shacl);
    }
    let agent = rt.block_on(conn.client().agent.me()).unwrap().did;
    let space = seed(&rt, &conn, &uuid);
    let relations = Relations::core();

    let all = cases();
    assert_eq!(all.len(), 17, "the TS suite has 17 cases");
    let mut failures = Vec::new();
    let mut gaps_now_passing = Vec::new();
    for case in &all {
        let ir: QueryIr = serde_json::from_value(fill(&case.query, &space, &agent)).unwrap();
        let outcome =
            we_ad4m::translate::model_query(&ir, Some(case.entity), &relations).and_then(|q| {
                let model = Model::new(conn.ws(), uuid.clone(), case.entity);
                rt.block_on(model.query(&q)).map_err(|e| format!("{e:#}"))
            });
        let answered = outcome.map(|r| compare(&r.instances, &case.expect, &space));
        match judge(case.gap, answered) {
            Verdict::Ok => eprintln!("ok    {}", case.id),
            Verdict::Gap(e) => eprintln!("gap   {} ({}): {e}", case.id, case.gap.unwrap().why),
            Verdict::GapClosed => gaps_now_passing.push(case.id),
            Verdict::Fail(e) => {
                eprintln!("FAIL  {}: {e}", case.id);
                failures.push(format!("{}: {e}", case.id));
            }
        }
    }
    assert!(
        gaps_now_passing.is_empty(),
        "known gaps now pass — take them off the list: {gaps_now_passing:?}"
    );
    assert!(
        failures.is_empty(),
        "{} of 17 failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A known gap: why, and the wrong answer it gives.
#[derive(Clone, Copy)]
struct Gap {
    why: &'static str,
    shape: GapShape,
}

#[derive(Clone, Copy)]
enum GapShape {
    /// Every row's number is this — a count that ignored its `where`.
    Counts(u64),
    /// Each row names one member at both ends — a projection whose `order`
    /// was ignored, so first and latest are whichever came first.
    SameMemberBothEnds,
}

impl GapShape {
    fn matches(self, got: &Value) -> bool {
        let Some(rows) = got.as_object().filter(|r| !r.is_empty()) else {
            return false;
        };
        rows.values().all(|v| match self {
            GapShape::Counts(n) => v.as_u64() == Some(n),
            GapShape::SameMemberBothEnds => match v.as_array().map(Vec::as_slice) {
                Some([a, b]) => a.is_string() && a == b,
                _ => false,
            },
        })
    }
}

enum Verdict {
    Ok,
    /// The known gap, as documented.
    Gap(String),
    /// A known gap that now answers right: take it off the list.
    GapClosed,
    Fail(String),
}

/// A case's outcome — its answer and the expected one, or why it did not
/// answer — against its known gap, if it has one.
fn judge(gap: Option<Gap>, answered: Result<(Value, Value), String>) -> Verdict {
    match (answered, gap) {
        (Ok((got, want)), None) if got == want => Verdict::Ok,
        (Ok((got, want)), Some(_)) if got == want => Verdict::GapClosed,
        (Ok((got, want)), Some(g)) if g.shape.matches(&got) => {
            Verdict::Gap(format!("got {got}, want {want}"))
        }
        (Ok((got, want)), _) => Verdict::Fail(format!("got {got}, want {want}")),
        (Err(e), _) => Verdict::Fail(format!("refused: {e}")),
    }
}

/// A known gap is a documented wrong answer, never any failure (Lal P3): a
/// gap case that is refused, or answers wrong in another way, has broken
/// for a new reason, and that must fail. Needs no executor.
#[test]
fn a_known_gap_is_only_its_documented_wrong_answer() {
    let cases = cases();
    let case = |id: &str| cases.iter().find(|c| c.id == id).unwrap();
    let reply_total = case("reply-total-leaves-calls-out");
    let newest = case("newest-in-a-channel");
    // The documented answers: every response counted; one member at both ends.
    assert!(matches!(
        judge(
            reply_total.gap,
            Ok((json!({ "post1": 3 }), json!({ "post1": 2 })))
        ),
        Verdict::Gap(_)
    ));
    assert!(matches!(
        judge(
            newest.gap,
            Ok((
                json!({ "channel": ["call", "call"] }),
                json!({ "channel": ["post1", "task2"] })
            ))
        ),
        Verdict::Gap(_)
    ));
    // Anything else is a failure, not the gap.
    assert!(matches!(
        judge(reply_total.gap, Err("RPC error 500: no such class".into())),
        Verdict::Fail(_)
    ));
    assert!(matches!(
        judge(
            reply_total.gap,
            Ok((json!({ "post1": 0 }), json!({ "post1": 2 })))
        ),
        Verdict::Fail(_)
    ));
    assert!(matches!(
        judge(
            newest.gap,
            Ok((
                json!({ "channel": [null, null] }),
                json!({ "channel": ["post1", "task2"] })
            ))
        ),
        Verdict::Fail(_)
    ));
    assert!(matches!(
        judge(
            newest.gap,
            Ok((json!({}), json!({ "channel": ["post1", "task2"] })))
        ),
        Verdict::Fail(_)
    ));
}
