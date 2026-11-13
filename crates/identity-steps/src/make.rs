//! Make an identity: 12 new words, shown to be written down; two of them, at random places,
//! asked back; then the master key derived from them, the incept built with this device's key,
//! co-signed, kept with master #0 in the vault and published.
//!
//! [`MakeWords`] is the identity client's `CreateFlow` with one difference: once the words are
//! confirmed it keeps the seed until the surface drops it, rather than spending it on the first
//! try at [`MakeWords::finish`]. A try that stops before the vault keeps master #0 — the
//! person cancelled the unlock prompt, the key store refused — is tried again with the same
//! words, which the person has already written down, instead of starting over with new ones. A
//! try that stops after it is the client's pending incept: `create_from_seed` publishes the kept
//! incept again rather than making another, and `resume` does so without the words.

use ad4m_identity_client::flows::create::{create_from_seed, Created};
use ad4m_identity_client::{ClientError, Clock, ExecutorRpc, Random, Secret, Vault, ViaExecutor};
use ad4m_identity_core::record::DeviceEntry;
use ad4m_identity_core::words::{self, Seed, Words};
use zeroize::Zeroizing;

/// Where a make is. The words and the seed are wiped when they drop (`Words` and `Seed` zero
/// their bytes).
enum Step {
    Shown(Words),
    Asked(Words, [usize; 2]),
    Confirmed(Seed),
}

/// A make of new words, one state per step. Dropping it wipes the words and the seed.
pub struct MakeWords {
    /// `None` only while a step moves the state on.
    step: Option<Step>,
}

fn random_index(random: &dyn Random, below: usize) -> usize {
    let mut bytes = Zeroizing::new([0u8; 8]);
    random.fill(&mut bytes[..]);
    (u64::from_le_bytes(*bytes) % below as u64) as usize
}

impl MakeWords {
    /// New words from 16 bytes of `random`.
    pub fn start(random: &dyn Random) -> MakeWords {
        let mut entropy = Zeroizing::new([0u8; 16]);
        random.fill(&mut entropy[..]);
        Self::from_words(words::from_entropy(&entropy))
    }

    /// A make over given words (tests, and a surface that made them itself).
    pub fn from_words(words: Words) -> MakeWords {
        MakeWords {
            step: Some(Step::Shown(words)),
        }
    }

    /// The 12 words, to show while they are written down; `None` once they are confirmed (they
    /// are wiped then). The copy wipes itself when it drops.
    pub fn words(&self) -> Option<Secret<Vec<String>>> {
        match self.step.as_ref()? {
            Step::Shown(words) | Step::Asked(words, _) => Some(Secret::new(
                words.words().iter().map(|w| w.to_string()).collect(),
            )),
            Step::Confirmed(_) => None,
        }
    }

    /// The places asked (counted from 1), once [`MakeWords::words_written`] chose them.
    pub fn positions(&self) -> Option<[usize; 2]> {
        match self.step.as_ref()? {
            Step::Asked(_, positions) => Some(*positions),
            _ => None,
        }
    }

    /// Whether the words were typed back right: [`MakeWords::finish`] may run.
    pub fn is_confirmed(&self) -> bool {
        matches!(self.step, Some(Step::Confirmed(_)))
    }

    /// The person wrote the words down: ask for two of them, at random distinct places (counted
    /// from 1, the smaller first). Only once, right after the words are shown.
    pub fn words_written(&mut self, random: &dyn Random) -> Result<[usize; 2], ClientError> {
        let Some(Step::Shown(words)) = self.step.take_if(|s| matches!(s, Step::Shown(_))) else {
            return Err(ClientError::Step("words_written follows start"));
        };
        let first = random_index(random, words::WORD_COUNT);
        let mut second = random_index(random, words::WORD_COUNT - 1);
        if second >= first {
            second += 1;
        }
        let positions = [first.min(second) + 1, first.max(second) + 1];
        self.step = Some(Step::Asked(words, positions));
        Ok(positions)
    }

    /// The two words typed back, in the order of the places asked; case and the spaces around
    /// them do not count. On a match the words are wiped and the seed kept for
    /// [`MakeWords::finish`]; on a mismatch, [`ClientError::WrongWords`], and the same places
    /// are asked again.
    pub fn confirm(&mut self, answers: [&str; 2]) -> Result<(), ClientError> {
        let Some(Step::Asked(words, positions)) =
            self.step.take_if(|s| matches!(s, Step::Asked(..)))
        else {
            return Err(ClientError::Step("confirm follows words_written"));
        };
        let list = words.words();
        let matches = positions
            .iter()
            .zip(answers)
            .all(|(p, a)| list[p - 1] == a.trim().to_lowercase());
        drop(list);
        if !matches {
            self.step = Some(Step::Asked(words, positions));
            return Err(ClientError::WrongWords);
        }
        let seed = words::seed(&words);
        drop(words);
        self.step = Some(Step::Confirmed(seed));
        Ok(())
    }

    /// Makes the identity on `executor` from the confirmed words: master #0 and the next
    /// commitment derived, the incept built with this device's key (`executor`'s status) and
    /// co-signed, master #0 and the incept kept in `vault`, the incept published, and the record
    /// written with this device as `this_device`, holding master #0. The seed stays for another
    /// try until the make is dropped.
    pub async fn finish<R: ExecutorRpc>(
        &self,
        executor: &ViaExecutor<R>,
        vault: &dyn Vault,
        this_device: DeviceEntry,
        clock: &dyn Clock,
        random: &dyn Random,
    ) -> Result<Created, ClientError> {
        let Some(Step::Confirmed(seed)) = &self.step else {
            return Err(ClientError::Step("finish follows confirm"));
        };
        create_from_seed(seed, executor, vault, this_device, clock, random).await
    }
}

/// Never the words: a surface that logs its state, or a test that panics with one, must not put
/// the 12 words in a log or a crash report.
impl std::fmt::Debug for MakeWords {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let step = match &self.step {
            Some(Step::Shown(_)) => "shown",
            Some(Step::Asked(..)) => "asked",
            Some(Step::Confirmed(_)) => "confirmed",
            None => "moving",
        };
        f.debug_struct("MakeWords").field("step", &step).finish()
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use ad4m_identity_client::flows::create::{CreateFlow, CreateScreen};

    use super::*;

    /// A random source that counts up, so two runs over it draw the same bytes.
    struct Counting(Cell<u8>);

    impl Random for Counting {
        fn fill(&self, out: &mut [u8]) {
            for byte in out {
                *byte = self.0.get();
                self.0.set(self.0.get().wrapping_add(37));
            }
        }
    }

    fn list(entropy: u8) -> Vec<String> {
        words::from_entropy(&[entropy; 16])
            .words()
            .iter()
            .map(|w| w.to_string())
            .collect()
    }

    #[test]
    fn the_words_and_the_places_asked_are_the_clients() {
        // The same random source gives the same words and the same places as the identity
        // client's `CreateFlow`, which the desktop ran before this crate.
        let mut make = MakeWords::start(&Counting(Cell::new(1)));
        let (mut flow, shown) = CreateFlow::start(&Counting(Cell::new(1)));
        let CreateScreen::ShowWords(theirs) = shown else {
            panic!("expected the words");
        };
        assert_eq!(make.words().unwrap().expose(), theirs.expose());
        for seed in [0u8, 5, 200] {
            let positions = make.words_written(&Counting(Cell::new(seed))).unwrap();
            let CreateScreen::ConfirmWords { positions: theirs } =
                flow.words_written(&Counting(Cell::new(seed))).unwrap()
            else {
                panic!("expected the places");
            };
            assert_eq!(positions, theirs);
            assert!(positions[0] < positions[1] && positions[1] <= 12);
            make = MakeWords::from_words(words::from_entropy(&[seed; 16]));
            flow = CreateFlow::from_words(words::from_entropy(&[seed; 16])).0;
        }
    }

    #[test]
    fn a_wrong_word_asks_again_and_the_right_ones_wipe_the_words() {
        let shown = list(9);
        let mut make = MakeWords::from_words(words::from_entropy(&[9; 16]));
        assert!(matches!(
            make.confirm(["a", "b"]),
            Err(ClientError::Step(_))
        ));
        let [a, b] = make.words_written(&Counting(Cell::new(3))).unwrap();
        assert!(matches!(
            make.words_written(&Counting(Cell::new(3))),
            Err(ClientError::Step(_))
        ));
        let wrong = if shown[a - 1] == "zoo" {
            "abandon"
        } else {
            "zoo"
        };
        assert!(matches!(
            make.confirm([wrong, &shown[b - 1]]),
            Err(ClientError::WrongWords)
        ));
        // Asked again at the same places, the words still there to show.
        assert_eq!(make.positions(), Some([a, b]));
        assert_eq!(make.words().unwrap().expose(), &shown);
        assert!(!make.is_confirmed());
        // Case and spaces around a word do not count.
        let first = format!("  {} ", shown[a - 1].to_uppercase());
        make.confirm([&first, &shown[b - 1]]).unwrap();
        assert!(make.is_confirmed());
        assert!(make.words().is_none(), "the words are wiped once confirmed");
        assert_eq!(make.positions(), None);
        assert_eq!(format!("{make:?}"), "MakeWords { step: \"confirmed\" }");
    }
}
