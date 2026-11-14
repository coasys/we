//! The browser backend's contract (brief test 7): `back()` asks the
//! browser to move, and the `popstate` it answers with is the app's cue to
//! call `open()` — this test proves the wiring by pushing two entries,
//! calling `back()`, and seeing the first href arrive at the popstate
//! listener (which is what calls `Navigator::open`).
//!
//! Needs a real browser — `wasm-pack test --headless`. CI cannot run one
//! yet (C3 owns the CI side), so it is `#[ignore]`d: on wasm it only runs
//! when asked for explicitly.
#![cfg(target_arch = "wasm32")]
#![allow(dead_code)]

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::*;
use we_screen::{BrowserHistory, HistoryBackend};

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
#[ignore]
async fn back_reports_the_first_href() {
    let mut history = BrowserHistory::new().expect("a window");
    history.push("#two");
    // The callback reports the full address — pathname + search + hash —
    // never the bare "#two" text pushed: capture what the bar shows.
    let two = history.current_href();
    history.push("#three");

    let seen = Rc::new(RefCell::new(Vec::<String>::new()));
    let seen_in = seen.clone();
    history.on_popstate(move |href| seen_in.borrow_mut().push(href));

    let moved = NextEvent::armed("popstate"); // armed before the ask — no race
    history.back();
    moved.fired().await;

    let seen = seen.borrow();
    assert!(
        seen.iter().any(|href| *href == two),
        "popstate should report the previous entry's address, saw {seen:?} (wanted {two})"
    );
}

/// A window 'error' listener — an uncaught exception inside an event
/// listener surfaces here. A `popstate` callback still registered after its
/// Rust `Closure` was dropped misbehaves on every move (a dead binding
/// throws, or runs on stale state); a correctly unwired one stays silent.
/// The listener comes back so the test can unwire it.
fn window_errors() -> (
    Rc<RefCell<Vec<String>>>,
    Closure<dyn FnMut(web_sys::ErrorEvent)>,
) {
    let errors = Rc::new(RefCell::new(Vec::<String>::new()));
    let errors_in = errors.clone();
    let listener = Closure::wrap(Box::new(move |e: web_sys::ErrorEvent| {
        errors_in.borrow_mut().push(e.message());
    }) as Box<dyn FnMut(web_sys::ErrorEvent)>);
    web_sys::window()
        .unwrap()
        .add_event_listener_with_callback("error", listener.as_ref().unchecked_ref())
        .unwrap();
    (errors, listener)
}

/// A one-shot window listener, armed NOW — `armed` registers synchronously,
/// so the listener really is in place before the call that fires the event
/// (an `async fn`'s body would not run until the first `.await` poll —
/// after `back()`). `fired` waits for the event, then unwires the listener
/// and lets the Closure drop: a used waiter leaves nothing registered, and
/// a dropped one cleans up too.
struct NextEvent {
    name: &'static str,
    listener: Option<Closure<dyn FnMut()>>,
    future: Option<wasm_bindgen_futures::JsFuture>,
    /// Invocations so far — the leak probe: a listener that outlives its
    /// promise keeps counting on every later event.
    fires: Rc<Cell<u32>>,
}

impl NextEvent {
    fn armed(name: &'static str) -> NextEvent {
        let fires = Rc::new(Cell::new(0));
        let mut listener = None;
        let promise = js_sys::Promise::new(&mut |resolve, _| {
            let fires_in = fires.clone();
            let cb = Closure::wrap(Box::new(move || {
                fires_in.set(fires_in.get() + 1);
                let _ = resolve.call0(&JsValue::NULL);
            }) as Box<dyn FnMut()>);
            web_sys::window()
                .unwrap()
                .add_event_listener_with_callback(name, cb.as_ref().unchecked_ref())
                .unwrap();
            listener = Some(cb);
        });
        NextEvent {
            name,
            listener,
            future: Some(wasm_bindgen_futures::JsFuture::from(promise)),
            fires,
        }
    }

    /// Wait for the event, then take the listener off the window — the
    /// Closure drops with it rather than being forgotten.
    async fn fired(mut self) -> Rc<Cell<u32>> {
        self.future.take().unwrap().await.unwrap();
        self.unwire();
        self.fires.clone()
    }

    fn unwire(&mut self) {
        if let Some(cb) = self.listener.take() {
            let _ = web_sys::window()
                .unwrap()
                .remove_event_listener_with_callback(self.name, cb.as_ref().unchecked_ref());
        }
    }
}

impl Drop for NextEvent {
    fn drop(&mut self) {
        self.unwire();
    }
}

/// Take an 'error' listener back off the window before its Closure dies —
/// the same lifetime rule the backend under test follows.
fn unwire_errors(listener: &Closure<dyn FnMut(web_sys::ErrorEvent)>) {
    web_sys::window()
        .unwrap()
        .remove_event_listener_with_callback("error", listener.as_ref().unchecked_ref())
        .unwrap();
}

#[wasm_bindgen_test]
#[ignore]
async fn replacing_the_listener_retires_the_old_one() {
    let (errors, errors_listener) = window_errors();
    let mut history = BrowserHistory::new().expect("a window");
    history.push("#a");
    history.push("#b");

    // Register, then rebind: "replaces any previous listener" — the first
    // must be unwired, not just shadowed while its Closure is dropped.
    let fired = Rc::new(RefCell::new(Vec::<&'static str>::new()));
    let f = fired.clone();
    history.on_popstate(move |_| f.borrow_mut().push("first"));
    let f = fired.clone();
    history.on_popstate(move |_| f.borrow_mut().push("second"));

    let moved = NextEvent::armed("popstate"); // armed before the ask — no race
    history.back();
    moved.fired().await;
    wait_for_popstate().await; // and any 'error' the dead one raises

    assert_eq!(
        fired.borrow().as_slice(),
        ["second"].as_slice(),
        "the replaced listener must not fire"
    );
    let errors = errors.borrow();
    assert!(
        errors.is_empty(),
        "a dropped callback stayed registered and misbehaved on popstate: {errors:?}"
    );
    drop(errors);
    unwire_errors(&errors_listener);
}

#[wasm_bindgen_test]
#[ignore]
async fn drop_unwires_the_listener() {
    let (errors, errors_listener) = window_errors();
    let window = web_sys::window().unwrap();
    let fired = Rc::new(RefCell::new(Vec::<&'static str>::new()));
    {
        let mut history = BrowserHistory::new().expect("a window");
        history.push("#a");
        history.push("#b");
        let f = fired.clone();
        history.on_popstate(move |_| f.borrow_mut().push("drop"));
        // `history` dies here — the DOM listener must go with it, or the
        // next popstate calls a callback that no longer exists.
    }
    let moved = NextEvent::armed("popstate");
    window.history().unwrap().back().unwrap();
    moved.fired().await;
    wait_for_popstate().await;

    assert!(
        fired.borrow().is_empty(),
        "a listener outlived its BrowserHistory and fired on popstate: {:?}",
        fired.borrow()
    );
    let errors = errors.borrow();
    assert!(
        errors.is_empty(),
        "a dropped callback stayed registered and misbehaved on popstate: {errors:?}"
    );
    drop(errors);
    unwire_errors(&errors_listener);
    // Put the address back for the next test in the binary — awaited: an
    // un-awaited traversal is still in flight when the next test arms its
    // listeners.
    let restored = NextEvent::armed("popstate");
    window.history().unwrap().forward().unwrap();
    restored.fired().await;
}

#[wasm_bindgen_test]
#[ignore]
async fn a_resolved_waiter_stops_listening() {
    let mut history = BrowserHistory::new().expect("a window");
    history.push("#w1");
    history.push("#w2");

    let waiter = NextEvent::armed("popstate");
    history.back();
    let fires = waiter.fired().await;
    // Resolved and unwired: the next event must not reach it.
    let gone = NextEvent::armed("popstate");
    history.forward();
    gone.fired().await;
    assert_eq!(
        fires.get(),
        1,
        "a resolved waiter kept listening — its Closure is still registered"
    );
}

async fn wait_for_popstate() {
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(resolve.unchecked_ref(), 50)
            .unwrap();
    });
    wasm_bindgen_futures::JsFuture::from(promise).await.unwrap();
}
