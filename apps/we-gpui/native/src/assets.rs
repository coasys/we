//! The web bundle over a custom scheme: `we://localhost/…` for the app, `we-identity://localhost/…`
//! for the identity window, each rooted at its own folder of `dist/`, so the identity window cannot
//! load an app page and the app cannot load the identity window's.
//!
//! Wry registers custom schemes as secure, so the page is a secure context (WebCrypto, media
//! devices) as it is under Tauri's `tauri://localhost`.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

use wry::http::{header, Request, Response, StatusCode};

pub const APP_SCHEME: &str = "we";
pub const IDENTITY_SCHEME: &str = "we-identity";

/// The URL wry serves `scheme` at: `<scheme>://localhost/` on Linux and macOS,
/// `http://<scheme>.localhost/` on Windows (WebView2 only routes http(s) to a handler).
pub fn origin(scheme: &str) -> String {
    if cfg!(windows) {
        format!("http://{scheme}.localhost")
    } else {
        format!("{scheme}://localhost")
    }
}

/// Where a bundle window opens: the origin's root, not `/index.html`. WE routes on the path, so a
/// window opened at `/index.html` asks its router for a page called `index.html` and gets none.
pub fn start_url(scheme: &str) -> String {
    format!("{}/", origin(scheme))
}

/// The file under `root` a request path names, or `None` when it would leave `root`. A path naming
/// no file with an extension falls back to `index.html`, so client-side routes load the app.
pub fn resolve(root: &Path, request_path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(request_path)
        .decode_utf8()
        .ok()?;
    let relative = decoded.split(['?', '#']).next().unwrap_or("");
    let mut path = root.to_path_buf();
    for component in Path::new(relative.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            // `..`, a root or a prefix: never followed, whatever it would resolve to.
            _ => return None,
        }
    }
    if path.is_file() {
        return Some(path);
    }
    let looks_like_a_file = Path::new(relative)
        .extension()
        .is_some_and(|ext| !ext.is_empty());
    (!looks_like_a_file).then(|| root.join("index.html"))
}

pub fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "ktx2" => "image/ktx2",
        _ => "application/octet-stream",
    }
}

/// The response for `request` from `root`.
pub fn serve(root: &Path, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let respond = |status: StatusCode, mime: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            .body(Cow::Owned(body))
            .expect("a static response builds")
    };
    let Some(path) = resolve(root, request.uri().path()) else {
        return respond(StatusCode::FORBIDDEN, "text/plain", b"forbidden".to_vec());
    };
    match std::fs::read(&path) {
        Ok(bytes) => respond(StatusCode::OK, mime(&path), bytes),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", b"not found".to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_opens_at_the_root_its_router_knows() {
        let url = start_url(APP_SCHEME);
        assert!(url.ends_with("localhost/"), "{url}");
        assert!(!url.contains("index.html"));
        // And the root still serves the app.
        let dir = bundle();
        assert_eq!(resolve(dir.path(), "/"), Some(dir.path().join("index.html")));
    }

    fn bundle() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "<html>").unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/app.js"), "x").unwrap();
        dir
    }

    #[test]
    fn files_resolve_under_the_root() {
        let dir = bundle();
        assert_eq!(
            resolve(dir.path(), "/assets/app.js"),
            Some(dir.path().join("assets/app.js"))
        );
        assert_eq!(resolve(dir.path(), "/"), Some(dir.path().join("index.html")));
    }

    #[test]
    fn a_route_falls_back_to_the_app_and_a_missing_file_does_not() {
        let dir = bundle();
        assert_eq!(
            resolve(dir.path(), "/spaces/abc"),
            Some(dir.path().join("index.html"))
        );
        assert_eq!(resolve(dir.path(), "/assets/missing.js"), None);
    }

    #[test]
    fn traversal_is_refused_however_it_is_spelled() {
        let dir = bundle();
        assert_eq!(resolve(dir.path(), "/../secret"), None);
        assert_eq!(resolve(dir.path(), "/assets/../../secret"), None);
        assert_eq!(resolve(dir.path(), "/%2e%2e/secret"), None);
        assert_eq!(resolve(dir.path(), "/assets/%2E%2E/%2E%2E/etc/passwd"), None);
    }

    #[test]
    fn a_query_does_not_change_the_file() {
        let dir = bundle();
        assert_eq!(
            resolve(dir.path(), "/assets/app.js?v=1"),
            Some(dir.path().join("assets/app.js"))
        );
    }

    #[test]
    fn types_follow_extensions() {
        assert_eq!(mime(Path::new("a.js")), "text/javascript; charset=utf-8");
        assert_eq!(mime(Path::new("a.wasm")), "application/wasm");
        assert_eq!(mime(Path::new("a.unknown")), "application/octet-stream");
    }

    #[test]
    fn serving_answers_forbidden_for_traversal() {
        let dir = bundle();
        let request = Request::builder()
            .uri("we://localhost/../x")
            .body(Vec::new())
            .unwrap();
        // The URI parser normalises nothing; the resolver refuses it.
        let response = serve(dir.path(), &request);
        assert!(matches!(
            response.status(),
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
        ));
        let ok = Request::builder()
            .uri("we://localhost/assets/app.js")
            .body(Vec::new())
            .unwrap();
        let response = serve(dir.path(), &ok);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(&response.body()[..], b"x");
    }
}
