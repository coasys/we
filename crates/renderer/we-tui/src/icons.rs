//! `we-icon` → a single-cell glyph.
//!
//! The egui frontend paints Phosphor font codepoints; a terminal has no
//! icon font, so this is a hand-curated name → printable-glyph table
//! (single-width chars only — the cell grid counts on it). A name the table
//! does not know falls back to the catalog label — the icon's `name` prop —
//! which stays truthful instead of guessing a mark.

/// The glyph for `name`, if the table has one.
pub fn glyph(name: &str) -> Option<&'static str> {
    Some(match name {
        // navigation / chrome
        "sidebar-simple" | "sidebar" => "▌",
        "gear-six" | "gear" | "wrench" => "⚙",
        "magnifying-glass" => "⌕",
        "x" | "trash" => "×",
        "plus" => "+",
        "check" => "✓",
        "caret-right" | "arrow-right" => "›",
        "arrow-left" => "‹",
        "arrow-bend-down-right" => "↳",
        "arrow-bend-left-up" | "arrow-bend-up-left" => "↰",
        "arrow-counter-clockwise" | "clock-counter-clockwise" => "↺",
        "download-simple" => "↓",
        "link" => "∞",
        "qr-code" => "▦",
        // communication
        "chats-circle" | "chat-circle" => "◉",
        "phone" | "phone-call" => "☎",
        "envelope-simple" => "✉",
        "paper-plane-tilt" => "➤",
        // people
        "user" => "☺",
        "users" | "users-three" => "☻",
        "hand-waving" => "✳",
        // content
        "note" | "file-text" => "≡",
        "book-open-text" => "≣",
        "hash" => "#",
        "check-square" | "flag-checkered" => "☑",
        "squares-four" | "layout" => "▤",
        "calendar" => "▣",
        "clock" | "live" => "◷",
        // space/dna
        "dna" => "⌬",
        "flow-arrow" => "⤳",
        "git-branch" => "⑃",
        "git-fork" => "⑂",
        "shapes" => "▨",
        "circle-half" => "◐",
        "scales" => "⚖",
        "leaf" => "❧",
        // decoration
        "star" => "★",
        "heart" => "♥",
        "push-pin" => "⚲",
        "sparkle" => "✦",
        "lightning" => "⚡",
        "palette" => "◪",
        "paint-bucket" => "◧",
        // tools / misc
        "toolbox" => "⚒",
        "key" => "⚿",
        "lock" => "⚷",
        "info" => "ℹ",
        "warning" => "⚠",
        "play" => "▶",
        "spinner" => "◌",
        "binoculars" => "⚯",
        "cursor-click" => "↖",
        "map-pin" => "⌖",
        "type" => "T",
        "tree" => "♣",
        "pencil-simple" | "pencil-simple-line" => "✎",
        "discord-logo" | "github-logo" => "◈",
        "line-segment" => "╱",
        "asc" => "↑",
        "dot-outline" | "live-dot" => "•",
        _ => return None,
    })
}
