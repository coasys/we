/**
 * A block nothing here can draw shows what its author wrote, not an apology.
 */
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { FallbackBlockCard } from '../src/components/FallbackBlockCard/FallbackBlockCard';

describe('FallbackBlockCard', () => {
  it('draws the kind, a name-like heading and a few short values, and leaves bookkeeping out', () => {
    const host = document.createElement('div');
    const dispose = render(
      () => (
        <FallbackBlockCard
          type="someone-elses-poll"
          block={{
            _type: 'someone-elses-poll',
            id: 'we://record',
            version: 3,
            question: 'Tea or coffee?',
            options: 'tea, coffee',
            art: 'data:image/png;base64,AAAA',
          }}
        />
      ),
      host,
    );
    const text = host.textContent ?? '';
    expect(text).toContain('Someone elses poll');
    expect(text).toContain('Tea or coffee?');
    expect(text).toContain('tea, coffee');
    expect(text).not.toContain('we://record');
    expect(text).not.toContain('base64');
    expect(text).not.toContain('Unsupported');
    dispose();
  });
});
