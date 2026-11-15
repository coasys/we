//! `offline-report` — resolve a route of the Coasys bundle against a recorded
//! snapshot and print which store members the snapshot served, which the
//! natives served, and which calls dropped unanswered.
//!
//! ```sh
//! cargo run -p we-data --example offline-report -- \
//!     --bundle ../../../bundles/coasys.bundle.json \
//!     --snapshot tests/data/coasys-mini.json \
//!     --route /space/demo
//! ```
use std::path::PathBuf;
use std::sync::Arc;

use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{AppSpec, Bundle, LocalState, NoParts, Runtime, StaticHost};

struct Args {
    bundle: PathBuf,
    snapshot: PathBuf,
    route: String,
    store_map: Option<PathBuf>,
    json: bool,
}

fn args() -> Result<Args, String> {
    let mut out = Args {
        bundle: PathBuf::from("../../../bundles/coasys.bundle.json"),
        snapshot: PathBuf::from("tests/data/coasys-mini.json"),
        route: "/space/demo".to_string(),
        store_map: None,
        json: false,
    };
    let mut rest = std::env::args().skip(1);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--bundle" => out.bundle = PathBuf::from(rest.next().ok_or("--bundle needs a path")?),
            "--snapshot" => {
                out.snapshot = PathBuf::from(rest.next().ok_or("--snapshot needs a path")?)
            }
            "--route" => out.route = rest.next().ok_or("--route needs a href")?,
            "--store-map" => {
                out.store_map = Some(PathBuf::from(
                    rest.next().ok_or("--store-map needs a path")?,
                ))
            }
            "--json" => out.json = true,
            other => return Err(format!("unknown flag {other}")),
        }
    }
    Ok(out)
}

fn main() -> Result<(), String> {
    let args = args()?;
    let bundle_text = std::fs::read_to_string(&args.bundle)
        .map_err(|e| format!("read {}: {e}", args.bundle.display()))?;
    let snapshot_text = std::fs::read_to_string(&args.snapshot)
        .map_err(|e| format!("read {}: {e}", args.snapshot.display()))?;
    let json: serde_json::Value =
        serde_json::from_str(&snapshot_text).map_err(|e| format!("parse snapshot: {e}"))?;
    let map = match &args.store_map {
        Some(path) => Some(StoreMap::load(path)?),
        // The seed map ships with the crate — natives fire without a flag.
        None => Some(StoreMap::load(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/data/storemap-offline.json"
        ))?),
    };
    let data = OfflineData::from_snapshot(&json, map.as_ref())?;

    let bundle = Bundle::parse(&bundle_text).map_err(|e| format!("parse bundle: {e}"))?;
    let locals = LocalState::new();
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    // The snapshot query source answers from the `queries` table once the
    // pool's cells report their names — noted between resolves below.
    let source = Arc::new(data.query_source());
    let noted = source.clone();
    let mut session = Session {
        runtime: Runtime::app(spec, data.bag.clone(), locals.clone()).with_sources(
            Some(source as Arc<dyn we_template::QuerySource>),
            Arc::new(NoParts),
        ),
        host: Box::new(StaticHost::new(data.bag.clone())),
        screen: ScreenState::desktop(
            ScreenSchema {
                pages: bundle
                    .pages
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .map(|p| p.id.clone())
                    .collect(),
                ..ScreenSchema::default()
            },
            &args.route,
        ),
    };
    session.resolve();
    // First pass compiled the cells and learned nothing yet; teach the
    // source their names and settle the rows they ask for.
    noted.note_pool(session.runtime.pool());
    session.resolve();
    // `$invoke` targets nothing answered — into the dropped count.
    data.provenance.absorb_dropped(std::mem::take(
        &mut session
            .host_mut_as::<StaticHost>()
            .expect("the offline host")
            .dropped,
    ));

    let report = data.provenance.report();
    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
        );
    } else {
        println!("route: {}", args.route);
        print!("{}", data.provenance.report_text());
    }
    Ok(())
}
