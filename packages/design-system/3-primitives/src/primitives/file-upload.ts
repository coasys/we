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
  p: '700',
  r: '500',
  border: '2px dashed var(--we-role-border)',
  color: 'text-muted',
  fontSize: '300',
  cursor: 'pointer',
};

const styles = css`
  [part='base'] {
    transition:
      border-color var(--we-transition-200, 150ms) ease,
      background var(--we-transition-200, 150ms) ease;
    min-height: 120px;
  }

  :host([dragover]) [part='base'] {
    border-color: var(--we-role-accent);
    background: var(--we-role-accent-soft);
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
    background: var(--we-role-page);
    border-radius: var(--we-radius-400);
    font-size: 0.875em;
    color: var(--we-role-text);
  }

  [part='remove'] {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    opacity: 0.5;
    transition: opacity var(--we-transition-200, 150ms) ease;
  }

  [part='remove']:hover {
    opacity: 1;
  }

  :host([disabled]) {
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
  /**
   * The files held, when the host owns the list: set it to `[]` after the files were taken (a message
   * sent with them) and the drop zone lets go of them. Left unset, the element keeps its own list.
   */
  @property({ type: Array }) files?: File[];
  /**
   * The most one file may hold, in bytes; `0` is no limit. A larger file is not added: the element
   * says so with a `reject` event — `detail.files`, and `detail.names` as one line to show — so the
   * host can tell the person why.
   */
  @property({ type: Number, attribute: 'max-size' }) maxSize = 0;
  /** Draw no list of the files held: the host shows them itself, as chips beside a one-button drop zone. */
  @property({ type: Boolean, attribute: 'hide-list' }) hideList = false;

  @state() private _files: File[] = [];
  @state() private _dragover = false;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('files') && this.files) this._files = [...this.files];
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

  private _addFiles(chosen: File[]) {
    const tooBig = this.maxSize > 0 ? chosen.filter((file) => file.size > this.maxSize) : [];
    const files = tooBig.length ? chosen.filter((file) => !tooBig.includes(file)) : chosen;
    if (files.length) {
      this._files = this.multiple ? [...this._files, ...files] : files.slice(0, 1);
      const detail = this.multiple ? this._files : (this._files[0] ?? null);
      this.dispatchEvent(new CustomEvent('change', { detail, bubbles: true, composed: true }));
    }
    // After the change, so a host that resets its note on a new choice does not erase this pick's own.
    if (tooBig.length) {
      this.dispatchEvent(
        new CustomEvent('reject', {
          detail: { files: tooBig, names: tooBig.map((file) => file.name).join(', ') },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _removeFile(index: number) {
    this._files = this._files.filter((_, i) => i !== index);
    const detail = this.multiple ? this._files : (this._files[0] ?? null);
    this.dispatchEvent(new CustomEvent('change', { detail, bubbles: true, composed: true }));
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

        ${
          this._files.length > 0 && !this.hideList
            ? html`
                <div part="file-list" @click=${(e: Event) => e.stopPropagation()}>
                  ${this._files.map(
                    (file, i) => html`
                      <div part="file-item">
                        <we-icon name="file" size="sm"></we-icon>
                        <span>${file.name}</span>
                        <we-button
                          part="remove"
                          variant="soft"
                          aria-label="Remove file"
                          @click=${() => this._removeFile(i)}
                        >
                          <we-icon name="x"></we-icon>
                        </we-button>
                      </div>
                    `,
                  )}
                </div>
              `
            : nothing
        }
      </div>
    `;
  }
}
