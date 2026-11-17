//! Overlay widgets — `we-modal`, `we-popover`, `DropdownMenu`. They are
//! [`crate::WidgetKind::Overlay`]: the walk paints them in tree order, then
//! the post-pass in `paint.rs` lays their un-slotted children out on an egui
//! layer — a centred `egui::Modal` or an anchored `egui::Popup`.
mod dropdown_menu;
mod modal;
mod popover;

pub use dropdown_menu::DropdownMenu;
pub use modal::Modal;
pub use popover::Popover;
