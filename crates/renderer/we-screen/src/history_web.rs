//! `BrowserHistory` — the web backend: the browser owns the stack, so
//! `push`/`replace` are `history.pushState`/`replaceState` and `back()`
//! asks the browser to move, with the answer arriving as a `popstate` the
//! app reports through `Navigator::open` (screen-state.md §4.2 — the same
//! split WE has between its router and `popstate`, `RouteStore.tsx:228-232`).
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::HistoryBackend;

/// The browser's `window.history` as a [`HistoryBackend`]. One listener at
/// a time: the app attaches a `popstate` handler that calls `nav.open` with
/// the href the browser landed on.
pub struct BrowserHistory {
    window: web_sys::Window,
    history: web_sys::History,
    popstate: Option<Closure<dyn FnMut()>>,
}

impl BrowserHistory {
    /// `window.history`; `None` where there is no window.
    pub fn new() -> Option<BrowserHistory> {
        let window = web_sys::window()?;
        let history = window.history().ok()?;
        Some(BrowserHistory {
            window,
            history,
            popstate: None,
        })
    }

    /// The `popstate` wiring — `f` is called with `location.pathname +
    /// search + hash` whenever the browser moves (a Back button, a
    /// `history.back()` answer). Replaces any previous listener.
    pub fn on_popstate(&mut self, f: impl Fn(String) + 'static) {
        self.remove_popstate();
        let window = self.window.clone();
        let closure = Closure::wrap(Box::new(move || {
            if let Some(loc) = window.location().pathname().ok().map(|pathname| {
                let l = window.location();
                format!(
                    "{}{}{}",
                    pathname,
                    l.search().unwrap_or_default(),
                    l.hash().unwrap_or_default()
                )
            }) {
                f(loc);
            }
        }) as Box<dyn FnMut()>);
        let _ = self
            .window
            .add_event_listener_with_callback("popstate", closure.as_ref().unchecked_ref());
        self.popstate = Some(closure);
    }

    /// Unwire the registered listener, if there is one — the DOM keeps the
    /// `Closure`'s function, so dropping it alone leaves a live listener
    /// pointing at a dead callback.
    fn remove_popstate(&mut self) {
        if let Some(closure) = self.popstate.take() {
            let _ = self.window.remove_event_listener_with_callback(
                "popstate",
                closure.as_ref().unchecked_ref(),
            );
        }
    }

    fn href_now(&self) -> String {
        let l = self.window.location();
        format!(
            "{}{}{}",
            l.pathname().unwrap_or_default(),
            l.search().unwrap_or_default(),
            l.hash().unwrap_or_default()
        )
    }
}

impl HistoryBackend for BrowserHistory {
    fn current_href(&self) -> String {
        self.href_now()
    }

    fn push(&mut self, href: &str) {
        let _ = self
            .history
            .push_state_with_url(&JsValue::NULL, "", Some(href));
    }

    fn replace(&mut self, href: &str) {
        let _ = self
            .history
            .replace_state_with_url(&JsValue::NULL, "", Some(href));
    }

    /// `history.back()` — the move is the browser's and arrives as
    /// `popstate`; nothing to return here.
    fn back(&mut self) -> Option<String> {
        let _ = self.history.back();
        None
    }

    /// `history.forward()` — same contract as [`Self::back`].
    fn forward(&mut self) -> Option<String> {
        let _ = self.history.forward();
        None
    }

    fn depth(&self) -> usize {
        self.history.length().unwrap_or(1).max(1) as usize
    }

    /// The History API does not say where in the stack the current entry
    /// sits; callers that need a position use `MemoryHistory`.
    fn index(&self) -> usize {
        self.depth().saturating_sub(1)
    }
}

impl Drop for BrowserHistory {
    fn drop(&mut self) {
        self.remove_popstate();
    }
}
