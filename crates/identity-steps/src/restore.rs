//! Restore from the 12 words, on a device of no identity: the words name the identity (the
//! store's key index knows whose master #0 they make), its devices are listed with the apps
//! ticked to lock out, and one rotation revokes the ticked ones and gives this device the new
//! master key; then this device joins as a device, and the apps not locked out are sent the key.
//!
//! The surface runs `RestoreFlow` itself (it borrows the executor and the vault, and its
//! enrolment is retried on the same flow); these are the parts it must do as the other surface
//! does.

use ad4m_identity_client::flows::restore::{Enrolled, RestoreFlow, Restored};
use ad4m_identity_client::{ClientError, ExecutorRpc, ViaExecutor};
use ad4m_identity_core::record::{DeviceEntry, DeviceKind};
use ad4m_identity_core::words::Words;
use ad4m_identity_core::KeyId;
use serde::Serialize;

use crate::epoch::{recover_lost_epoch, EpochRecovery};

/// One device on the restore's lock-out list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDevice {
    pub key_id: String,
    /// The record's name; `None` when the record does not name it or could not be read.
    pub name: Option<String>,
    pub kind: Option<DeviceKind>,
    /// Ticked by default: apps, and a device the record does not name; not servers, community
    /// hosts, Coasys cloud or bots.
    pub lock_out: bool,
}

/// The note shown above the list when the record could not be read.
pub const RECORD_UNREAD: &str = "Couldn't read your device list, so devices show without names.";

/// The identity's valid devices other than this one, as the lock-out screen lists them.
pub fn listed<R: ExecutorRpc>(flow: &RestoreFlow<'_, R>) -> Vec<RestoreDevice> {
    flow.devices()
        .iter()
        .map(|d| RestoreDevice {
            key_id: d.key_id.as_str().to_string(),
            name: d.name.clone(),
            kind: d.kind,
            lock_out: d.lock_out,
        })
        .collect()
}

/// [`RECORD_UNREAD`] when the flow could not read the record.
pub fn record_note<R: ExecutorRpc>(flow: &RestoreFlow<'_, R>) -> Option<String> {
    flow.record_error().map(|e| {
        log::warn!("identity: the record could not be read for the restore: {e}");
        RECORD_UNREAD.to_string()
    })
}

/// The devices to lock out, when every one of `key_ids` is on the list; `None` when one is not
/// (the surface answers a wrong input and asks again).
pub fn lock_out_of(devices: &[RestoreDevice], key_ids: &[String]) -> Option<Vec<KeyId>> {
    key_ids
        .iter()
        .all(|k| devices.iter().any(|d| &d.key_id == k))
        .then(|| key_ids.iter().map(|k| KeyId::from(k.as_str())).collect())
}

/// The restore's rotation, revoking `lock_out`, and this device's enrolment as `entry`. Before
/// the stage the rotation makes, a custody epoch of this identity the device lost (a first
/// restore stopped, a file gone) is recovered with `words`, checked first to make the
/// identity's current master. Once this answers `Ok` the rotation is published: the identity is
/// restored and the lock-out stands, whatever `enrolled` says.
pub async fn finish_restore<R: ExecutorRpc>(
    flow: &mut RestoreFlow<'_, R>,
    executor: &ViaExecutor<R>,
    epochs: &dyn EpochRecovery,
    words: &Words,
    lock_out: &[KeyId],
    entry: DeviceEntry,
) -> Result<Restored, ClientError> {
    let did = flow.did().to_string();
    recover_lost_epoch(executor, epochs, &did, words).await?;
    flow.finish(lock_out, entry).await
}

/// This device's enrolment again, after a restore whose rotation was published and whose
/// enrolment was not: the same flow, which holds the words and refuses a second rotation. The
/// same words, checked again, recover an epoch lost since the rotation.
pub async fn enrol_again<R: ExecutorRpc>(
    flow: &RestoreFlow<'_, R>,
    executor: &ViaExecutor<R>,
    epochs: &dyn EpochRecovery,
    words: &Words,
    entry: DeviceEntry,
) -> Result<Enrolled, ClientError> {
    recover_lost_epoch(executor, epochs, flow.did(), words).await?;
    flow.enrol(entry).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(key_id: &str, kind: Option<DeviceKind>, lock_out: bool) -> RestoreDevice {
        RestoreDevice {
            key_id: key_id.into(),
            name: None,
            kind,
            lock_out,
        }
    }

    #[test]
    fn a_lock_out_names_only_devices_on_the_list() {
        let devices = vec![
            device("d1", Some(DeviceKind::DesktopApp), true),
            device("d2", Some(DeviceKind::Server), false),
        ];
        assert_eq!(
            lock_out_of(&devices, &["d1".into()]),
            Some(vec![KeyId::from("d1")])
        );
        assert_eq!(lock_out_of(&devices, &[]), Some(vec![]));
        assert_eq!(lock_out_of(&devices, &["d1".into(), "d9".into()]), None);
    }

    #[test]
    fn a_device_serialises_as_the_identity_window_reads_it() {
        let json = serde_json::to_value(device("d2", Some(DeviceKind::PhoneApp), true)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"keyId": "d2", "name": null, "kind": "phone-app", "lockOut": true})
        );
    }
}
