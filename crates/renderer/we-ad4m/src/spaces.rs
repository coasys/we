//! The agent's perspectives, for the left rail.
use crate::connection::Connection;

/// Perspectives the executor keeps for itself. They are not spaces: the web
/// sidebar leaves them out (`we-root`, `we-personal`, `we-test`), and so
/// does the rail. A name that merely starts with `we-` is still a space.
const SYSTEM_SPACES: &[&str] = &["we-root", "we-personal", "we-test"];

/// Whether `name` is one of [`SYSTEM_SPACES`].
pub fn is_system_space(name: &str) -> bool {
    SYSTEM_SPACES.contains(&name)
}

/// `rows` without the system perspectives, in the same order.
pub fn agent_spaces(rows: &[SpaceRow]) -> Vec<SpaceRow> {
    rows.iter()
        .filter(|r| !is_system_space(&r.name))
        .cloned()
        .collect()
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str) -> SpaceRow {
        SpaceRow {
            uuid: name.into(),
            name: name.into(),
            shared_url: None,
        }
    }

    #[test]
    fn system_perspectives_are_not_agent_spaces() {
        let rows = vec![
            row("we-root"),
            row("Notes"),
            row("we-personal"),
            row("we-test"),
            row("we-custom"),
        ];
        let names: Vec<_> = agent_spaces(&rows).into_iter().map(|r| r.name).collect();
        assert_eq!(names, vec!["Notes".to_string(), "we-custom".to_string()]);
    }
}
