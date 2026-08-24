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
  styles?: Record<string, string | number>;
}
