/**
 * What a scenario does in a window, as a person would: read the text on screen, press a control by
 * its words, type into a field by its label or placeholder. Run in the window by the harness
 * build's `eval`, with the rights of a script in that window.
 *
 * Everything works through open shadow roots too: the main window's controls are web components.
 * Only what is visible counts, so a scenario cannot press a control a person could not see.
 */

/** The helpers, as the source of a script that defines `h` in the function body it is put in. */
export const HELPERS = String.raw`
const h = (() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!(el instanceof Element)) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** Every element under a root, through open shadow roots, in document order. */
  function* all(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const kids = [];
      if (node.shadowRoot) kids.push(node.shadowRoot);
      for (const child of node.children || []) kids.push(child);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      if (node instanceof Element) yield node;
    }
  }

  /** The text a person sees, through shadow roots and slots. */
  function text(root = document.body) {
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (parent && visible(parent) && !SKIP.has(parent.tagName)) parts.push(node.data);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (node.tagName && SKIP.has(node.tagName)) return;
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return;
      if (node.shadowRoot) {
        walk(node.shadowRoot);
        return; // The light children show through the shadow root's slots, walked below.
      }
      if (node.tagName === 'SLOT') {
        const assigned = node.assignedNodes({ flatten: true });
        for (const child of assigned.length ? assigned : node.childNodes) walk(child);
        return;
      }
      for (const child of node.childNodes) walk(child);
      if (node.tagName && /^(P|DIV|H[1-6]|LI|BUTTON|LABEL|TR|SECTION)$/.test(node.tagName)) parts.push('\n');
    };
    walk(root);
    return parts.join(' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n+/g, '\n').trim();
  }

  const CONTROLS = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], we-button, we-menu-item, we-tab, label';

  function controlText(el) {
    return norm(el.getAttribute('aria-label') || el.getAttribute('label') || el.getAttribute('title') || text(el));
  }

  /** The visible, enabled controls whose words are exactly these, or contain them; the smallest first. */
  function controls(words) {
    const want = norm(words).toLowerCase();
    const found = [];
    for (const el of all(document)) {
      if (!el.matches(CONTROLS) || !visible(el)) continue;
      const said = controlText(el).toLowerCase();
      if (!said) continue;
      if (said === want) found.push({ el, rank: 0, size: said.length });
      else if (said.includes(want)) found.push({ el, rank: 1, size: said.length });
    }
    found.sort((a, b) => a.rank - b.rank || a.size - b.size);
    return found.map((f) => f.el);
  }

  function disabled(el) {
    return Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'));
  }

  /** Presses the control with these words. Fails if there is none, or it is disabled. */
  function press(words) {
    const [el] = controls(words);
    if (!el) throw new Error('no control "' + words + '" on screen; it shows:\n' + text().slice(0, 1500));
    if (disabled(el)) throw new Error('the control "' + words + '" is disabled');
    el.scrollIntoView({ block: 'center' });
    el.click();
    return controlText(el);
  }

  function labelOf(input) {
    const parts = [input.getAttribute('aria-label'), input.getAttribute('placeholder'), input.getAttribute('name')];
    const label = input.closest('label');
    if (label) parts.push(text(label));
    if (input.id) {
      const root = input.getRootNode();
      const named = root.querySelector && root.querySelector('label[for="' + input.id + '"]');
      if (named) parts.push(text(named));
    }
    const host = input.getRootNode().host;
    if (host) parts.push(host.getAttribute('label'), host.getAttribute('placeholder'));
    return norm(parts.filter(Boolean).join(' '));
  }

  /** The visible fields whose label, placeholder or name contains these words. */
  function fields(words) {
    const want = norm(words).toLowerCase();
    const found = [];
    for (const el of all(document)) {
      if (!el.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea') || !visible(el)) continue;
      if (labelOf(el).toLowerCase().includes(want)) found.push(el);
    }
    return found;
  }

  /**
   * Presses the control that shows only this icon, as a person presses the gear they see. For the
   * controls that have no words; a control with words is pressed by them.
   */
  function pressIcon(name) {
    for (const el of all(document)) {
      if (!el.matches(CONTROLS) || !visible(el) || controlText(el)) continue;
      const icon = [...all(el)].find((i) => i.tagName === 'WE-ICON' && i.getAttribute('name') === name);
      if (!icon) continue;
      if (disabled(el)) throw new Error('the ' + name + ' button is disabled');
      el.click();
      return name;
    }
    throw new Error('no ' + name + ' button on screen');
  }

  /** Types a value into the field with these words, as typing would: the value, then input and change. */
  function type(words, value, index = 0) {
    const el = fields(words)[index];
    if (!el) throw new Error('no field "' + words + '" on screen');
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return labelOf(el);
  }

  /** Ticks the checkbox whose label contains these words. */
  function tick(words) {
    const want = norm(words).toLowerCase();
    for (const el of all(document)) {
      if (!el.matches('input[type=checkbox]') || !visible(el)) continue;
      const label = el.closest('label');
      if (label && text(label).toLowerCase().includes(want)) {
        if (!el.checked) el.click();
        return true;
      }
    }
    throw new Error('no checkbox "' + words + '" on screen');
  }

  /** What is on screen to act on: controls and fields with their words, for a report or a failure. */
  function inventory() {
    const out = { controls: [], fields: [] };
    for (const el of all(document)) {
      if (!visible(el)) continue;
      if (el.matches(CONTROLS)) out.controls.push(controlText(el) + (disabled(el) ? ' (disabled)' : ''));
      else if (el.matches('input, textarea')) out.fields.push(labelOf(el) + ' [' + (el.type || el.tagName) + ']');
    }
    return out;
  }

  return { text, press, pressIcon, type, tick, controls, fields, inventory, all, visible, norm };
})();
`;

/** A script body with the helpers in scope as `h`. */
export function withHelpers(body: string): string {
  return `${HELPERS}\n${body}`;
}
