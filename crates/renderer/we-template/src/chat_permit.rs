//! A permit for one chat mutation, bound to the live mount.
//!
//! Resolve stamps each node's origin from the mount it was resolved under.
//! The host publishes the live mount and its generation. [`issue_chat_permit`]
//! is the only constructor. A Space-tier origin, a different mount, a stale
//! generation, or a missing origin returns `None`. The caller must not run
//! the mutation. A template cannot mint a permit or raise its tier.
use std::cell::RefCell;
use std::collections::HashMap;

use we_expr::{MountId, Tier};

use crate::resolved::NodeId;

/// Where one resolved node sits. Resolve writes it. A template does not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatOrigin {
    pub mount: MountId,
    pub tier: Tier,
    pub generation: u64,
}

/// The host's live chat mount for this frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMount {
    mount: MountId,
    generation: u64,
}

impl ChatMount {
    pub fn new(mount: impl Into<MountId>, generation: u64) -> Self {
        Self {
            mount: mount.into(),
            generation,
        }
    }

    pub fn mount(&self) -> &MountId {
        &self.mount
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
}

/// One chat mutation. The permit names this exact intent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatIntent {
    Send,
    Resend(String),
    Cancel,
    Delete(String),
}

/// Proof the host allowed one chat mutation. No public constructor.
#[derive(Clone, Debug)]
pub struct ChatPermit {
    mount: MountId,
    generation: u64,
    intent: ChatIntent,
}

impl ChatPermit {
    pub fn mount(&self) -> &MountId {
        &self.mount
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn intent(&self) -> &ChatIntent {
        &self.intent
    }

    /// The call the host is about to run is the call this permit allowed.
    pub fn matches(&self, mount: &MountId, generation: u64, intent: &ChatIntent) -> bool {
        &self.mount == mount && self.generation == generation && &self.intent == intent
    }
}

thread_local! {
    static LIVE: RefCell<Option<ChatMount>> = const { RefCell::new(None) };
    static ORIGINS: RefCell<HashMap<NodeId, ChatOrigin>> = RefCell::new(HashMap::new());
}

/// Publish the live mount for this thread. `None` is unmounted: no permit.
pub fn bind_chat_mount(mount: Option<ChatMount>) {
    LIVE.with(|slot| *slot.borrow_mut() = mount);
}

pub fn chat_mount() -> Option<ChatMount> {
    LIVE.with(|slot| slot.borrow().clone())
}

pub fn clear_chat_origins() {
    ORIGINS.with(|slot| slot.borrow_mut().clear());
}

pub fn stamp_chat_origin(id: NodeId, origin: ChatOrigin) {
    ORIGINS.with(|slot| slot.borrow_mut().insert(id, origin));
}

pub fn publish_chat_origins(origins: &HashMap<NodeId, ChatOrigin>) {
    ORIGINS.with(|slot| *slot.borrow_mut() = origins.clone());
}

pub(crate) fn take_chat_origins() -> HashMap<NodeId, ChatOrigin> {
    ORIGINS.with(|slot| std::mem::take(&mut *slot.borrow_mut()))
}

pub fn chat_origin(id: &NodeId) -> Option<ChatOrigin> {
    ORIGINS.with(|slot| slot.borrow().get(id).cloned())
}

/// Mint a permit for `node`'s stamped origin against the live mount, or `None`.
pub fn issue_chat_permit(node: &NodeId, intent: ChatIntent) -> Option<ChatPermit> {
    let live = chat_mount()?;
    let origin = chat_origin(node)?;
    if origin.tier < Tier::App {
        return None;
    }
    if origin.mount != live.mount {
        return None;
    }
    if origin.generation != live.generation {
        return None;
    }
    Some(ChatPermit {
        mount: live.mount,
        generation: live.generation,
        intent,
    })
}
