use std::path::PathBuf;

pub struct AppState {
    /// The executor's port: its WebSocket RPC (`/api/v1/ws`) and `GET /health`.
    pub executor_port: u16,
    pub req_credential: String,
    /// Where this app keeps its own configuration — the account registry, and the directories of
    /// accounts it created. Resolved once at startup and carried here so the account commands do
    /// not each have to re-derive it.
    pub config_dir: PathBuf,
    /// The seed's data path, which the registry seeds itself with on first run.
    pub default_data_path: PathBuf,
}
