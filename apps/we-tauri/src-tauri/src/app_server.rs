use std::path::PathBuf;
use warp::Filter;

/// Generic static file server for serving bundled apps
/// This allows the WE launcher to serve any app (Flux, or others) via HTTP
/// without X-Frame-Options restrictions that would prevent iframe loading
pub async fn serve_static_app(port: u16, app_dir: PathBuf) {
    // Create a warp filter to serve static files from the app directory
    let routes = warp::fs::dir(app_dir).with(warp::reply::with::header(
        "Cache-Control",
        "no-cache, no-store, must-revalidate",
    ));

    println!(
        "Starting embedded app HTTP server on http://localhost:{}",
        port
    );

    warp::serve(routes).run(([127, 0, 0, 1], port)).await;
}
