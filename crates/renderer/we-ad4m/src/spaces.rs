//! The agent's perspectives, for the space picker.
use crate::connection::Connection;

/// One perspective the agent holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpaceRow {
    pub uuid: String,
    pub name: String,
    /// The neighbourhood URL of a shared perspective; `None` for a local one.
    pub shared_url: Option<String>,
}

impl SpaceRow {
    pub fn is_shared(&self) -> bool {
        self.shared_url.is_some()
    }
}

/// Every perspective, shared ones first, then by name. WE's own system
/// perspectives (`we-root`, `we-personal`, …) are listed last — they are
/// not spaces, but nothing stops opening one.
pub async fn list_spaces(conn: &Connection) -> anyhow::Result<Vec<SpaceRow>> {
    let client = conn.client();
    let handles = conn
        .run(async move { client.perspectives.all().await })
        .await?;
    let mut rows: Vec<SpaceRow> = handles
        .into_iter()
        .map(|h| SpaceRow {
            name: h
                .name
                .clone()
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| h.uuid.clone()),
            shared_url: h.shared_url.filter(|u| !u.is_empty()),
            uuid: h.uuid,
        })
        .collect();
    rows.sort_by_key(|r| {
        (
            r.name.starts_with("we-"),
            !r.is_shared(),
            r.name.to_lowercase(),
        )
    });
    Ok(rows)
}
