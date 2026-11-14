//! Picker widgets — `we-date-picker`, `we-color-picker`, `we-icon-picker`.
//! Small bespoke implementations (no new crate deps): a month-grid
//! calendar, a swatch row plus hex field, and a searchable Phosphor name
//! grid. All emit `{detail: value}` on `onChange`.
mod color_picker;
mod date_picker;
mod icon_picker;

pub use color_picker::ColorPicker;
pub use date_picker::DatePicker;
pub use icon_picker::IconPicker;
