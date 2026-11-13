//! What a step that published left undone, in the sentences a person reads. The step stands
//! either way, so a note never says that nothing changed.

use ad4m_identity_client::ClientError;
use ad4m_identity_core::KeyId;

/// What the hand-over of a new master key left undone: the apps it has not reached yet, and the
/// device list not updated yet. `again` says when this device sends the key again (the desktop:
/// "this computer sends it again each time it unlocks.").
pub fn handed_over(
    pushes: &[(KeyId, Result<String, ClientError>)],
    record: &Result<u64, ClientError>,
    again: &str,
) -> Option<String> {
    let mut note = Vec::new();
    let late: Vec<&str> = pushes
        .iter()
        .filter(|(_, pushed)| pushed.is_err())
        .map(|(key_id, _)| key_id.as_str())
        .collect();
    for (key_id, pushed) in pushes {
        if let Err(e) = pushed {
            log::warn!("identity: the new master key did not reach {key_id} yet: {e}");
        }
    }
    if !late.is_empty() {
        note.push(format!(
            "The new master key has not reached {} yet: {again}",
            late.join(", ")
        ));
    }
    if let Err(e) = record {
        log::warn!("identity: the record was not written after the rotation: {e}");
        note.push(
            "Your device list does not show it yet: it is updated the next time a device \
             changes it."
                .into(),
        );
    }
    (!note.is_empty()).then(|| note.join(" "))
}

/// Two notes as one, either or both absent.
pub fn joined(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (a, b) => a.or(b),
    }
}

/// Key ids as the screens show them.
pub fn key_ids(keys: &[KeyId]) -> Vec<String> {
    keys.iter().map(|k| k.as_str().to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hand_over_names_the_apps_it_missed_and_a_record_not_written() {
        let again = "this phone sends it again.";
        assert_eq!(handed_over(&[], &Ok(3), again), None);
        let pushes = vec![
            (KeyId::from("d2"), Ok("m1".to_string())),
            (KeyId::from("d3"), Err(ClientError::LogBusy)),
            (KeyId::from("d4"), Err(ClientError::LogBusy)),
        ];
        assert_eq!(
            handed_over(&pushes, &Ok(3), again).unwrap(),
            "The new master key has not reached d3, d4 yet: this phone sends it again."
        );
        let both = handed_over(&pushes, &Err(ClientError::LogBusy), again).unwrap();
        assert!(
            both.ends_with("updated the next time a device changes it."),
            "{both}"
        );
        assert_eq!(joined(None, Some("b".into())), Some("b".into()));
        assert_eq!(
            joined(Some("a".into()), Some("b".into())),
            Some("a b".into())
        );
    }
}
