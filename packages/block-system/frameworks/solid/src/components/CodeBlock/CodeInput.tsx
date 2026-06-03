import { Column, Row } from '@we/components/solid';
import { createSignal } from 'solid-js';

interface CodeInputProps {
  code: string | undefined;
  language: string | undefined;
  title: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

const LANGUAGE_OPTIONS = [
  { label: 'Language', value: '' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Python', value: 'python' },
  { label: 'Rust', value: 'rust' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'JSON', value: 'json' },
  { label: 'Bash', value: 'bash' },
  { label: 'SQL', value: 'sql' },
  { label: 'Go', value: 'go' },
  { label: 'Java', value: 'java' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
];

export function CodeInput(props: CodeInputProps) {
  const [language, setLanguage] = createSignal(props.language || '');

  function handleCodeInput(e: CustomEvent) {
    props.onChange('code', e.detail);
  }

  function handleLanguageChange(e: CustomEvent) {
    setLanguage(e.detail);
    props.onChange('language', e.detail);
  }

  return (
    <Column class="we-code-block" onClick={props.onSelect} gap="0">
      <Row ay="center" p="200" bg="neutral-100" r="300">
        <we-select value={language()} options={LANGUAGE_OPTIONS} onChange={handleLanguageChange} size="xs" />
      </Row>
      <we-textarea
        value={props.code || ''}
        onInput={handleCodeInput}
        placeholder="Enter code..."
        rows={6}
        resize="vertical"
        class="we-code-block-textarea"
      />
    </Column>
  );
}
