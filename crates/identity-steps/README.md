# we-identity-steps

The identity steps the desktop and the phone share: make an identity from new words, restore one
from its 12 words, and replace its master key with them. A library only — nothing runs it on its
own.

Two crates use it, by path:

- `crates/custody` — the desktop's identity window (`src/service.rs`), over the executor's RPC.
- `crates/phone-custody` — the phone's step machines (`src/steps.rs`), over the identity store's
  HTTPS (`ViaStore`), with no executor on the phone.

Each keeps its own conversation with the person and its own vault. What both must do alike lives
here, so a make, a restore or a replace means the same thing on either.

## Modules

| Module    | What it holds                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `make`    | `MakeWords`: the 12 words made (`Zeroizing`), two positions asked back, and the identity made from the seed with this device's key in its incept |
| `words`   | Why typed words were refused, in the sentences a person reads                                                                                    |
| `epoch`   | `EpochRecovery`, `recover_lost_epoch`, `words_make_current_master`: the words-gated way back from a lost custody epoch, before a rotation        |
| `rotate`  | Replace the master key with the words                                                                                                            |
| `restore` | The lock-out list, its check, and the restore's rotation and enrolment                                                                           |
| `notes`   | What a hand-over of a new master key left undone                                                                                                 |

Generic over `ad4m_identity_client::ExecutorRpc`; nothing here names the executor, a transport or
a platform.

## Boundary

`tests/boundary.rs` keeps it that way: the crate depends on no executor, transport or platform
crate, and its ad4m rev is the one `crates/custody` and `crates/phone-custody` name (one ad4m per
WE build, or the ad4m types the steps take would not be the ones the others pass).
`scripts/bump-ad4m.mjs` moves all three crates' revs and lockfiles together.

## Testing

```sh
cd crates/identity-steps
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The flows themselves are tested where they run: `crates/custody` (the identity window, against its
fakes) and `crates/phone-custody` (`tests/store.rs` against an in-process identity store,
`tests/real_store.rs` against the store binary).
