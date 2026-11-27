//! `we-ad4m`: [`we_store::Executor`] over `ad4m-client` — the WebSocket RPC to
//! a real AD4M executor. Nothing above this crate knows about WebSockets.
//!
//! E7 builds it, once `ad4m-client` (AD4M task A4) exists to depend on.
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn placeholder() {
        // E7: the adapter drives the level-2 conformance queries against a
        // real executor.
    }
}
