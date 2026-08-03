// @vitest-environment jsdom
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import { AssistantConfigPanel } from '../src/components/AssistantConfigPanel';
import { AssistantContext } from '../src/store';
import { makeMockStore } from './mockStore';

afterEach(cleanup);

function renderPanel(store = makeMockStore()) {
  return render(() => (
    <AssistantContext.Provider value={store}>{(<AssistantConfigPanel />) as JSX.Element}</AssistantContext.Provider>
  ));
}

describe('AssistantConfigPanel', () => {
  it('renders the four config tabs', () => {
    renderPanel();
    for (const id of ['assistants', 'personalities', 'skills', 'mcp']) {
      expect(screen.getByTestId(`config-tab-${id}`)).toBeTruthy();
    }
  });

  it('shows the assistant editor with model + grant groups on the default tab', () => {
    const { container } = renderPanel();
    // Assistant picker lists both assistants.
    const options = Array.from(container.querySelectorAll('select option')).map((o) => o.textContent);
    expect(options).toContain('Research Assistant');
    expect(options).toContain('Coding Assistant');
    // All three grant groups render, each listing its grantable items by name.
    expect(screen.getByText('MCP servers')).toBeTruthy(); // unique heading (tab label is "MCP")
    expect(screen.getByText('Friendly')).toBeTruthy(); // personality grant row
    expect(screen.getByText('web-search')).toBeTruthy(); // skill grant row
    expect(screen.getByText('filesystem')).toBeTruthy(); // mcp server grant row
  });

  it('toggles a personality grant on the active assistant', () => {
    const store = makeMockStore();
    renderPanel(store);
    // The Friendly personality appears as a grantable row in the assistant editor.
    (screen.getByText('Friendly') as HTMLElement).click();
    expect(store.toggleGrant).toHaveBeenCalledWith('a1', 'personalityIds', 'p1');
  });

  it('switches to the Personalities tab and lists personalities', () => {
    renderPanel();
    (screen.getByTestId('config-tab-personalities') as HTMLElement).click();
    expect(screen.getByText('Terse')).toBeTruthy();
    // Body preview text from the fixture.
    expect(screen.getByText('Minimal words. No filler.')).toBeTruthy();
  });

  it('switches to the Skills tab and lists skills', () => {
    renderPanel();
    (screen.getByTestId('config-tab-skills') as HTMLElement).click();
    expect(screen.getByText('web-search')).toBeTruthy();
    expect(screen.getByText('calculator')).toBeTruthy();
  });

  it('switches to the MCP tab and lists servers with a transport control', () => {
    const { container } = renderPanel();
    (screen.getByTestId('config-tab-mcp') as HTMLElement).click();
    expect(screen.getByText('filesystem')).toBeTruthy();
    // Transport <select> is present with the stdio/sse/http/websocket options.
    const optionTexts = Array.from(container.querySelectorAll('select option')).map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(['stdio', 'sse', 'http', 'websocket']));
  });

  it('creates a personality from the editor', () => {
    const store = makeMockStore();
    const { container } = renderPanel(store);
    (screen.getByTestId('config-tab-personalities') as HTMLElement).click();
    const nameInput = container.querySelector('we-input');
    expect(nameInput).toBeTruthy();
    nameInput!.dispatchEvent(new CustomEvent('input', { detail: 'Focused', bubbles: true }));
    (screen.getByText('Add') as HTMLElement).click();
    expect(store.createPersonality).toHaveBeenCalledWith(expect.objectContaining({ name: 'Focused' }));
  });
});
