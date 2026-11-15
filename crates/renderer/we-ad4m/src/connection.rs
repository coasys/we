//! [`Connection`]: an authenticated socket to an executor and the tokio
//! runtime its tasks run on. The only place in the renderer that owns a
//! runtime: the app's frame loop is not async, so the adapter's work runs
//! on a small multi-thread runtime of its own and answers through the
//! session inbox, which is `Send + Sync` by design.
use std::future::Future;
use std::sync::Arc;

use ad4m_client::ws_rpc::WsRpcClient;
use ad4m_client::Ad4mClient;

/// The runtime the adapter's tasks run on. Hold it for as long as any
/// [`Connection`] is in use; dropping it stops every live subscription.
pub struct Runtime {
    rt: tokio::runtime::Runtime,
}

impl Runtime {
    /// Two workers: a socket reader, the subscription tasks and a connect
    /// flow are all I/O-bound.
    pub fn new() -> std::io::Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("we-ad4m")
            .enable_all()
            .build()?;
        Ok(Self { rt })
    }

    pub fn handle(&self) -> tokio::runtime::Handle {
        self.rt.handle().clone()
    }

    /// Run `f` to completion from a thread that is not a runtime worker —
    /// tests and one-shot CLI reads.
    pub fn block_on<F: Future>(&self, f: F) -> F::Output {
        self.rt.block_on(f)
    }
}

/// A socket the executor accepted, plus where its tasks run. Cheap to clone.
#[derive(Clone)]
pub struct Connection {
    handle: tokio::runtime::Handle,
    ws: Arc<WsRpcClient>,
}

impl std::fmt::Debug for Connection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("connected", &self.ws.is_connected())
            .finish()
    }
}

impl Connection {
    pub fn new(handle: tokio::runtime::Handle, ws: Arc<WsRpcClient>) -> Self {
        Self { handle, ws }
    }

    /// Open a socket with `token` (empty for an executor without an admin
    /// credential, where a loopback caller is the operator). Runs on
    /// `handle`.
    pub async fn open(
        handle: tokio::runtime::Handle,
        url: &str,
        token: &str,
    ) -> anyhow::Result<Self> {
        let url = url.to_string();
        let token = token.to_string();
        let ws = handle
            .spawn(async move { WsRpcClient::connect(&url, &token).await })
            .await??;
        Ok(Self::new(handle, Arc::new(ws)))
    }

    pub fn ws(&self) -> &Arc<WsRpcClient> {
        &self.ws
    }

    pub fn client(&self) -> Ad4mClient {
        Ad4mClient::from_ws(self.ws.clone())
    }

    pub fn handle(&self) -> &tokio::runtime::Handle {
        &self.handle
    }

    pub fn is_connected(&self) -> bool {
        self.ws.is_connected()
    }

    /// Run `f` on the connection's runtime.
    pub fn spawn<F>(&self, f: F) -> tokio::task::JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.handle.spawn(f)
    }

    /// Run `f` on the runtime and wait for it from anywhere — a caller on
    /// another executor (the `?Send` [`we_data::Executor`] futures) awaits
    /// the result without being inside tokio.
    pub async fn run<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: Future<Output = anyhow::Result<T>> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.handle.spawn(async move {
            let _ = tx.send(f.await);
        });
        rx.await
            .map_err(|_| anyhow::anyhow!("the adapter runtime stopped"))?
    }
}
