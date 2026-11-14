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

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen_test::*;
use we_screen::{BrowserHistory, HistoryBackend};

#[wasm_bindgen_test]
#[ignore]
async fn back_reports_the_first_href() {
    let mut history = BrowserHistory::new().expect("a window");
    let start = history.current_href();
    history.push("#two");
    history.push("#three");

    let seen = Rc::new(RefCell::new(Vec::<String>::new()));
    let seen_in = seen.clone();
    history.on_popstate(move |href| seen_in.borrow_mut().push(href));

    history.back();
    // The move is the browser's: let it fire `popstate` before asserting.
    wait_for_popstate().await;

    let seen = seen.borrow();
    assert!(
        seen.iter().any(|href| href == "#two"),
        "popstate should report the previous entry, saw {seen:?} (start {start})"
    );
}

async fn wait_for_popstate() {
    use wasm_bindgen::JsCast;
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(resolve.unchecked_ref(), 50)
            .unwrap();
    });
    wasm_bindgen_futures::JsFuture::from(promise).await.unwrap();
}
