//! Why typed words were refused, in the sentences a person reads. A word is named by its place
//! only: the word typed, or the list word nearest it, may be one of the 12.

use ad4m_identity_core::words::WordsError;

/// Words that are all on the list and pass the checksum, yet make no master key of the identity.
pub const NOT_THESE_WORDS: &str = "This recovery phrase doesn't match your identity. Check the \
     spelling and order of each word. Nothing changed.";

/// The two words typed back at a make are not the words at the places asked.
pub const WRONG_CONFIRM: &str = "Those are not the words at those places. Check your paper.";

/// Why the 12 words typed were refused, and the word it names (from 1).
pub fn words_refused(e: &WordsError) -> (String, Option<usize>) {
    match e {
        WordsError::Count(n) => {
            let noun = if *n == 1 { "word" } else { "words" };
            (
                format!("That's {n} {noun}. Enter all 12 words in order."),
                None,
            )
        }
        WordsError::UnknownWord { position, .. } => (
            format!("Word {position} isn't a recovery phrase word. Check its spelling."),
            Some(*position),
        ),
        WordsError::Checksum => (
            "One or more words are wrong. Check the spelling and order of each word.".into(),
            None,
        ),
        WordsError::Index(_) => (
            "Your master key can't be replaced again with this recovery phrase.".into(),
            None,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ad4m_identity_core::words;

    #[test]
    fn a_refusal_names_a_word_by_its_place_and_never_by_what_was_typed() {
        let list = words::from_entropy(&[3; 16]);
        let mut typed: Vec<String> = list.words().iter().map(|w| w.to_string()).collect();
        typed[4] = "zzzzq".into();
        let e = words::parse(&typed.join(" ")).unwrap_err();
        let (message, position) = words_refused(&e);
        assert_eq!(position, Some(5));
        assert!(message.starts_with("Word 5 "), "{message}");
        assert!(!message.contains("zzzzq"));

        let (message, position) = words_refused(&words::parse("abandon").unwrap_err());
        assert_eq!(message, "That's 1 word. Enter all 12 words in order.");
        assert_eq!(position, None);
    }
}
