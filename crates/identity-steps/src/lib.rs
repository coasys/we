//! The identity steps the desktop and the phone share: make an identity from new words, restore
//! one from its 12 words, and replace its master key with them.
//!
//! Each surface keeps its own conversation with the person — the desktop's identity window
//! (`crates/custody`'s `service.rs`), the phone's step machine (`crates/phone-custody`'s
//! `steps.rs`) — and its own vault. What both must do alike is here:
//!
//! - [`make`]: the words made and shown, two of them asked back, and the identity made from the
//!   seed with this device's key in its incept ([`make::MakeWords`]).
//! - [`words`]: why typed words were refused, in the sentences a person reads.
//! - [`epoch`]: the words-gated way back from a lost custody epoch, before a rotation.
//! - [`rotate`]: replace the master key with the words.
//! - [`restore`]: the lock-out list, its check, and the restore's rotation and enrolment.
//! - [`notes`]: what a hand-over of a new master key left undone.
//!
//! Generic over [`ExecutorRpc`](ad4m_identity_client::ExecutorRpc): the desktop runs these over
//! the executor's RPC, the phone over the identity store's HTTPS (`ViaStore`). Nothing here names
//! the executor, a transport or a platform.

pub mod epoch;
pub mod make;
pub mod notes;
pub mod restore;
pub mod rotate;
pub mod words;

pub use epoch::{recover_lost_epoch, words_make_current_master, EpochRecovery};
pub use make::MakeWords;
pub use notes::{handed_over, joined, key_ids};
pub use restore::{enrol_again, finish_restore, listed, lock_out_of, record_note, RestoreDevice};
pub use rotate::rotate_with_words;
pub use words::{words_refused, NOT_THESE_WORDS, WRONG_CONFIRM};
