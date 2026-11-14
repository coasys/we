//! The stack behind `Navigator` — the browser's on web, an in-app vector on
//! desktop (screen-state.md §4.2). A backend owns the entries; the navigator
//! owns what they mean.

/// Where the back/forward stack lives.
pub trait HistoryBackend {
    /// The address the stack currently points at — what `Navigator::new`
    /// reports from, and what a traversal lands on.
    fn current_href(&self) -> String;
    /// Push an entry (truncating any forward entries first).
    fn push(&mut self, href: &str);
    /// Rewrite the current entry.
    fn replace(&mut self, href: &str);
    /// `history.back()`: the href landed on, or `None` at the start of the
    /// stack — or when the move arrives asynchronously, as a browser's does;
    /// then the `popstate` listener reports it through `Navigator::open`.
    fn back(&mut self) -> Option<String>;
    /// `history.forward()`, same contract as [`HistoryBackend::back`].
    fn forward(&mut self) -> Option<String>;
    /// How many entries the stack holds.
    fn depth(&self) -> usize;
    /// Where in it the current entry sits, 0-based.
    fn index(&self) -> usize;
}

/// The desktop backend: an in-app vector, one entry per location. The script
/// mirror in `recordNavigation.ts` defines the same semantics — a traversal
/// moves within the entries and stops at either end.
#[derive(Debug)]
pub struct MemoryHistory {
    entries: Vec<String>,
    index: usize,
}

impl MemoryHistory {
    /// A stack of one entry — where the session starts.
    pub fn new(start: &str) -> MemoryHistory {
        MemoryHistory {
            entries: vec![start.to_string()],
            index: 0,
        }
    }
}

impl HistoryBackend for MemoryHistory {
    fn current_href(&self) -> String {
        self.entries[self.index].clone()
    }

    fn push(&mut self, href: &str) {
        self.entries.truncate(self.index + 1);
        self.entries.push(href.to_string());
        self.index += 1;
    }

    fn replace(&mut self, href: &str) {
        if self.entries.is_empty() {
            self.entries.push(href.to_string());
        } else {
            self.entries[self.index] = href.to_string();
        }
    }

    fn back(&mut self) -> Option<String> {
        if self.index == 0 {
            None
        } else {
            self.index -= 1;
            Some(self.entries[self.index].clone())
        }
    }

    fn forward(&mut self) -> Option<String> {
        if self.index + 1 >= self.entries.len() {
            None
        } else {
            self.index += 1;
            Some(self.entries[self.index].clone())
        }
    }

    fn depth(&self) -> usize {
        self.entries.len()
    }

    fn index(&self) -> usize {
        self.index
    }
}
