/**
 * `we-file-upload` lets a host take the files it holds back: a message composer lists what is
 * attached and, once the message is sent, sets `files` to `[]` so the drop zone does not go on
 * showing files that were already sent.
 */
import './file-upload';

import { describe, expect, it } from 'vitest';

interface UploadEl extends HTMLElement {
  files?: File[];
  multiple: boolean;
  updateComplete: Promise<unknown>;
}

async function mount() {
  const el = document.createElement('we-file-upload') as UploadEl;
  el.multiple = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const names = (el: UploadEl) =>
  [...(el.shadowRoot?.querySelectorAll('[part="file-item"] span') ?? [])].map((n) => n.textContent);

describe('we-file-upload files', () => {
  it('shows the files a host gives it and lets go of them when given none', async () => {
    const el = await mount();
    el.files = [new File(['a'], 'plan.pdf'), new File(['b'], 'map.png')];
    await el.updateComplete;
    expect(names(el)).toEqual(['plan.pdf', 'map.png']);

    el.files = [];
    await el.updateComplete;
    expect(names(el)).toEqual([]);
  });
});
