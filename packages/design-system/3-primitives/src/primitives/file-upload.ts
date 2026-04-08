import type { DesignSystemProps } from '@we/design-types';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  ay: 'center',
  ax: 'center',
  gap: '300',
  p: '800',
  r: '500',
  border: '2px dashed var(--we-color-neutral-300)',
  color: 'neutral-500',
  fontSize: '400',
  cursor: 'pointer',
};

const styles = css`
  [part='base'] {
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
    min-height: 120px;
  }

  :host([dragover]) [part='base'] {
    border-color: var(--we-color-primary-500);
    background: var(--we-color-primary-50);
  }

  input[part='native'] {
    display: none;
  }

  [part='file-list'] {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--we-space-100);
  }

  [part='file-item'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
    padding: var(--we-space-100) var(--we-space-200);
    background: var(--we-color-neutral-50);
    border-radius: var(--we-radius-400);
    font-size: 0.875em;
    color: var(--we-color-neutral-700);
  }

  [part='remove'] {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }

  [part='remove']:hover {
    opacity: 1;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-file-upload')
export default class FileUpload extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) accept = '';
  @property({ type: Boolean }) multiple = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _files: File[] = [];
  @state() private _dragover = false;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  private _click() {
    const input = this.renderRoot.querySelector<HTMLInputElement>('[part="native"]');
    input?.click();
  }

  private _onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) this._addFiles(Array.from(input.files));
    input.value = '';
  }

  private _addFiles(files: File[]) {
    this._files = this.multiple ? [...this._files, ...files] : files.slice(0, 1);
    this.dispatchEvent(new CustomEvent('change', { detail: this._files, bubbles: true, composed: true }));
  }

  private _removeFile(index: number) {
    this._files = this._files.filter((_, i) => i !== index);
    this.dispatchEvent(new CustomEvent('change', { detail: this._files, bubbles: true, composed: true }));
  }

  private _onDragOver(e: DragEvent) {
    e.preventDefault();
    this._dragover = true;
    this.setAttribute('dragover', '');
  }

  private _onDragLeave() {
    this._dragover = false;
    this.removeAttribute('dragover');
  }

  private _onDrop(e: DragEvent) {
    e.preventDefault();
    this._dragover = false;
    this.removeAttribute('dragover');
    if (e.dataTransfer?.files) {
      this._addFiles(Array.from(e.dataTransfer.files));
    }
  }

  render() {
    return html`
      <div
        part="base"
        style=${styleMap(this.styles || {})}
        @click=${this._click}
        @dragover=${this._onDragOver}
        @dragleave=${this._onDragLeave}
        @drop=${this._onDrop}
      >
        <input
          part="native"
          type="file"
          accept=${this.accept || nothing}
          ?multiple=${this.multiple}
          @change=${this._onFileSelect}
        />
        <slot>
          <we-icon name="upload-simple" size="32px"></we-icon>
          <span>Drop files here or click to browse</span>
        </slot>

        ${this._files.length > 0
          ? html`
              <div part="file-list" @click=${(e: Event) => e.stopPropagation()}>
                ${this._files.map(
                  (file, i) => html`
                    <div part="file-item">
                      <we-icon name="file" size="14px"></we-icon>
                      <span>${file.name}</span>
                      <button part="remove" aria-label="Remove file" @click=${() => this._removeFile(i)}>
                        <we-icon name="x" size="14px"></we-icon>
                      </button>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
