export type CodeEditorLanguage = 'json' | 'css';

export interface CodeEditorProps {
  code: string;
  language?: CodeEditorLanguage;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onSave?: (code: string) => void;
  /**
   * Cap the editor's height and let it shrink to its content below that.
   *
   * Without it the editor is `height: 100%`, which is right for a panel filling a dock and wrong
   * for a disclosure showing seven lines of JSON — it reserves the full height either way. Given a
   * cap, the editor sizes to what it holds and CodeMirror's own scroller takes over past it.
   *
   * Any CSS length. Set this *or* a height in `styles`, not both.
   */
  maxHeight?: string;
  /**
   * Handed the editor's own `find()` once it has loaded, for a toolbar to put a control on.
   *
   * CodeMirror's search is there and reachable only by Mod-F, which is a door with no handle: a
   * reader looking for a value in a long document has no way to know it exists. The same shape
   * `BlockComposer` uses for `save()` — the component owns the behaviour, the caller owns where
   * the button goes.
   */
  onReady?: (api: { find: () => void }) => void;
  /**
   * How many matches the current search has, as it changes — `query` empty when the search closes.
   *
   * Reported outward rather than drawn into CodeMirror's own panel, which is its DOM to change.
   * `capped` says the count stopped early: a template is hundreds of thousands of characters and a
   * one-letter query matches most of them, so counting every one on every keystroke is work nobody
   * asked for. Show it as "500+".
   */
  onSearchMatches?: (result: { query: string; matches: number; capped: boolean }) => void;
  styles?: Record<string, string | number>;
}
