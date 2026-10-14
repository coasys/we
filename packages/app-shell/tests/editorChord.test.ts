/**
 * The host's chord for the editor — Ctrl+Alt+Shift+E, or ⌘⌥⇧E — the twin of safe mode's …+S.
 *
 * An app template decides whether the chrome has any button that opens the editor; this chord is the
 * host's, so an app with none is still one key from being changed back.
 */
import { isEditorChord } from '@shared/editorChord';
import { describe, expect, it } from 'vitest';

// Plain objects: the predicate reads four fields, and this project runs without a DOM.
const key = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

describe('the editor chord', () => {
  it('is Ctrl or ⌘ with Alt and Shift and E, read by position so ⌥ cannot change it', () => {
    expect(isEditorChord(key({ code: 'KeyE', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(true);
    expect(isEditorChord(key({ code: 'KeyE', metaKey: true, altKey: true, shiftKey: true, key: '´' }))).toBe(true);
  });

  it('is nothing short of all four', () => {
    expect(isEditorChord(key({ code: 'KeyE', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isEditorChord(key({ code: 'KeyE', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isEditorChord(key({ code: 'KeyS', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
  });
});
