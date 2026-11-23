/**
 * Ctrl+Alt+Shift+E, or ⌘⌥⇧E — the host's chord for the editor, the twin of safe mode's …+S.
 * `code` rather than `key`, which ⌥ changes.
 */
export function isEditorChord(event: KeyboardEvent): boolean {
  return event.code === 'KeyE' && !!event.altKey && !!event.shiftKey && !!(event.ctrlKey || event.metaKey);
}

/**
 * What a press of the chord does: leave a session that is open, or ask for one. Visual editing comes
 * on only with a session that opened — asking to edit a built-in offers its fork instead, and with no
 * session the outlines and selection visual editing draws would sit on a template nobody is editing.
 */
export function pressEditorChord(editor: {
  editing: () => boolean;
  exit: () => void;
  /** Ask for a session; whether one opened. */
  enter: () => boolean;
  toVisual: () => void;
}): void {
  if (editor.editing()) editor.exit();
  else if (editor.enter()) editor.toVisual();
}
