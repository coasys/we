/**
 * Ctrl+Alt+Shift+E, or ⌘⌥⇧E — the host's chord for the editor, the twin of safe mode's …+S.
 * `code` rather than `key`, which ⌥ changes.
 */
export function isEditorChord(event: KeyboardEvent): boolean {
  return event.code === 'KeyE' && !!event.altKey && !!event.shiftKey && !!(event.ctrlKey || event.metaKey);
}
