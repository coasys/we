//! [`Registry`]: widget type → implementation. A `ty` it does not know gets
//! the [`UnknownWidget`] fallback; the app registers builtins and its own
//! overrides.
use std::collections::HashMap;
use std::sync::Arc;

use crate::unknown::UnknownWidget;
use crate::Widget;

/// The registry: type name → widget impl, plus the unknown-type fallback.
/// One `Registry` belongs to one `Runtime` — each app registers its own
/// builtins and overrides.
///
/// ```
/// use we_widgets::Registry;
///
/// let reg = Registry::empty();
/// assert_eq!(reg.widget_for("nonsense").type_name(), "__unknown__");
/// ```
#[derive(Default)]
pub struct Registry {
    widgets: HashMap<&'static str, Arc<dyn Widget>>,
    unknown: Arc<UnknownWidget>,
}

impl std::fmt::Debug for Registry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut names: Vec<_> = self.widgets.keys().collect();
        names.sort();
        f.debug_struct("Registry").field("types", &names).finish()
    }
}

impl Registry {
    /// An empty registry — no widgets; every type gets the red box.
    pub fn empty() -> Self {
        Self {
            widgets: HashMap::new(),
            unknown: Arc::new(UnknownWidget),
        }
    }

    /// The builtin set — E3a's six plus the E5a batch: layout containers,
    /// text, media, the button, feedback and the tree pair. E5b registers
    /// its own on top.
    pub fn with_builtins() -> Self {
        let mut reg = Self::empty()
            .with(crate::Row)
            .with(crate::Column)
            .with(crate::Grid)
            .with(crate::Card)
            .with(crate::Div)
            .with(crate::Lane)
            .with(crate::Text)
            .with(crate::Link)
            .with(crate::Timestamp)
            .with(crate::Typewriter)
            .with(crate::Icon)
            .with(crate::Image)
            .with(crate::Avatar)
            .with(crate::AvatarStack)
            .with(crate::AnimatedIcon)
            .with(crate::Button)
            .with(crate::Tooltip)
            .with(crate::Badge)
            .with(crate::Tag)
            .with(crate::Alert)
            .with(crate::Skeleton)
            .with(crate::Divider)
            .with(crate::Tree)
            .with(crate::TreeItem);
        crate::placeholders::register(&mut reg);
        reg
    }

    /// `ty` → widget impl, or the unknown box for a `ty` it does not know.
    pub fn widget_for(&self, ty: &str) -> Arc<dyn Widget> {
        self.widgets
            .get(ty)
            .cloned()
            .unwrap_or_else(|| self.unknown.clone())
    }

    /// Register `widget` under its `type_name`, replacing any registered
    /// before. Returns the registry for chaining.
    pub fn with<W: Widget + 'static>(mut self, widget: W) -> Self {
        self.widgets.insert(widget.type_name(), Arc::new(widget));
        self
    }

    /// Register a widget in place (`with`'s mutating sibling — placeholder
    /// tables call it in a loop).
    pub fn register<W: Widget + 'static>(&mut self, widget: W) {
        self.widgets.insert(widget.type_name(), Arc::new(widget));
    }

    /// Register a shared widget.
    pub fn with_arc(&mut self, widget: Arc<dyn Widget>) {
        self.widgets.insert(widget.type_name(), widget);
    }
}
