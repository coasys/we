//! Every type the registry can paint must have a catalog entry — a missing
//! one means a frontend that renders the catalog (a TUI, a screen-reader
//! fallback) would meet a widget it cannot describe.
use we_egui::Registry;

#[test]
fn every_registered_widget_has_a_catalog_entry() {
    let reg = Registry::with_builtins();
    let mut missing = Vec::new();
    for ty in reg.type_names() {
        if we_catalog::entry(ty).is_none() {
            missing.push(ty.to_string());
        }
    }
    assert!(
        missing.is_empty(),
        "catalog is missing entries for: {}",
        missing.join(", ")
    );
}
