//! The read observer's contract: an [`Env`] answering
//! [`Env::read_observer`] hears `(path, effective value)` once per read —
//! roots, members, indices — while an env that leaves the default `None`
//! evaluates untouched.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use we_expr::{eval, parse, CallableRef, Env, MapEnv, MapNamespace, ReadObserver, Value};

/// A `MapEnv` that reports every read the evaluator makes to a log.
struct Observed {
    inner: MapEnv,
    observe: Box<ReadObserver<'static>>,
}

impl Env for Observed {
    fn root(&self, name: &str) -> Option<Value> {
        self.inner.root(name)
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        self.inner.call(name, args)
    }

    fn read_observer(&self) -> Option<&ReadObserver<'_>> {
        Some(self.observe.as_ref())
    }
}

type Log = Rc<RefCell<Vec<(String, Value)>>>;

/// `env` wrapped so every observed read lands in the returned log.
fn observed(inner: MapEnv) -> (Observed, Log) {
    let log = Rc::new(RefCell::new(Vec::new()));
    let sink = log.clone();
    (
        Observed {
            inner,
            observe: Box::new(move |path, value| {
                sink.borrow_mut().push((path.to_string(), value.clone()));
            }),
        },
        log,
    )
}

/// The paths the log heard, in order.
fn paths(log: &Rc<RefCell<Vec<(String, Value)>>>) -> Vec<String> {
    log.borrow().iter().map(|(p, _)| p.clone()).collect()
}

#[test]
fn every_link_of_a_read_chain_is_reported() {
    // `store.items[0].sig` — each read reports under its own name with
    // the value the expression sees, and the `sig` accessor runs once
    // for the one syntactic read it stands for.
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let item = Value::Obj(Arc::new(
        [(
            "sig".into(),
            Value::Callable(CallableRef::accessor("sig", move |_| {
                count.fetch_add(1, Ordering::Relaxed);
                Value::from("A")
            })),
        )]
        .into_iter()
        .collect(),
    ));
    let store = Value::from(MapNamespace::new(
        [("items".into(), Value::List(Arc::new(vec![item])))]
            .into_iter()
            .collect(),
    ));
    let (env, log) = observed(MapEnv::new().with_root("store", store));
    let value = eval(&parse("store.items[0].sig").unwrap(), &env);
    assert!(value.strict_eq(&Value::from("A")));
    assert_eq!(
        paths(&log),
        ["store", "store.items", "store.items.0", "store.items.0.sig"],
    );
    assert_eq!(calls.load(Ordering::Relaxed), 1, "one read, one call");
}

#[test]
fn an_accessor_member_reports_its_answer_and_reads_inside_compose() {
    // `store.items` where `items` is an accessor answering a list: the
    // member read reports the ANSWER (the list, not the callable), and
    // reads inside that answer compose under `store.items`.
    let list = Value::List(Arc::new(vec![Value::Obj(Arc::new(
        [("x".into(), Value::from(7.0))].into_iter().collect(),
    ))]));
    let list_read = list.clone();
    let store = Value::from(MapNamespace::new(
        [(
            "items".into(),
            Value::Callable(CallableRef::accessor("items", move |_| list_read.clone())),
        )]
        .into_iter()
        .collect(),
    ));
    let (env, log) = observed(MapEnv::new().with_root("store", store));
    let value = eval(&parse("store.items[0].x").unwrap(), &env);
    assert!(value.strict_eq(&Value::from(7.0)));
    assert_eq!(
        paths(&log),
        ["store", "store.items", "store.items.0", "store.items.0.x"],
    );
    let items = &log.borrow()[1].1;
    assert!(
        items.strict_eq(&list),
        "the accessor's own allocation is reported, not the callable: {items:?}"
    );
}

#[test]
fn a_dynamic_index_names_the_value_it_evaluated_to() {
    // `store.items[i]` — `i` is a read of its own, and the element read
    // is named by what `i` evaluated to.
    let store = Value::from(MapNamespace::new(
        [(
            "items".into(),
            Value::List(Arc::new(vec![Value::from("zero"), Value::from("one")])),
        )]
        .into_iter()
        .collect(),
    ));
    let (env, log) = observed(
        MapEnv::new()
            .with_root("store", store)
            .with_root("i", Value::from(1.0)),
    );
    let value = eval(&parse("store.items[i]").unwrap(), &env);
    assert!(value.strict_eq(&Value::from("one")));
    assert_eq!(paths(&log), ["store", "store.items", "i", "store.items.1"]);
}

#[test]
fn reads_through_an_unnamed_result_are_not_reported() {
    // `f().x` — the call's answer has no name; the `x` read under it is
    // the caller's own input, not a named dep.
    let (env, log) = observed(MapEnv::new().with_function("f", |_| {
        Value::Obj(Arc::new(
            [("x".into(), Value::from(1.0))].into_iter().collect(),
        ))
    }));
    let value = eval(&parse("f().x").unwrap(), &env);
    assert!(value.strict_eq(&Value::from(1.0)));
    assert!(paths(&log).is_empty(), "no named reads: {:?}", paths(&log));
}

#[test]
fn only_the_reads_that_happened_are_reported() {
    // `cond ? a : b` — the alternate's read never happened.
    let (env, log) = observed(
        MapEnv::new()
            .with_root("cond", Value::Bool(true))
            .with_root("a", Value::from(1.0))
            .with_root("b", Value::from(2.0)),
    );
    let value = eval(&parse("cond ? a : b").unwrap(), &env);
    assert!(value.strict_eq(&Value::from(1.0)));
    assert_eq!(paths(&log), ["cond", "a"]);
}
