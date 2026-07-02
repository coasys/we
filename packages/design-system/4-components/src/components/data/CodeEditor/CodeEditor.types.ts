export type CodeEditorLanguage = 'json' | 'css';

export interface CodeEditorProps {
  code: string;
  language?: CodeEditorLanguage;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onSave?: (code: string) => void;
  styles?: Record<string, string | number>;
}
