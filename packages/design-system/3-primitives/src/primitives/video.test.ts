/**
 * `we-video`'s captions: a template lists its tracks as data and each becomes a `<track>` inside the
 * video, so a film's words can be read with the sound off.
 */
import './video';

import { afterEach, describe, expect, it } from 'vitest';

interface VideoEl extends HTMLElement {
  src: string;
  tracks: { src: string; srclang?: string; label?: string; kind?: string; default?: boolean }[];
  crossorigin?: string;
  updateComplete: Promise<unknown>;
}

async function mount(props: Partial<VideoEl>): Promise<HTMLVideoElement> {
  const el = document.createElement('we-video') as VideoEl;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el.shadowRoot!.querySelector('video')!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a video with captions', () => {
  it('draws a track for each, captions unless it says otherwise, and the default one on', async () => {
    const video = await mount({
      src: 'film.mp4',
      tracks: [
        { src: 'film.en.vtt', srclang: 'en', label: 'English', default: true },
        { src: 'film.de.vtt', srclang: 'de', label: 'Deutsch', kind: 'subtitles' },
      ],
    });
    const tracks = [...video.querySelectorAll('track')];
    expect(tracks.map((t) => [t.getAttribute('src'), t.getAttribute('kind'), t.hasAttribute('default')])).toEqual([
      ['film.en.vtt', 'captions', true],
      ['film.de.vtt', 'subtitles', false],
    ]);
    expect(tracks[0].getAttribute('label')).toBe('English');
  });

  it('asks with CORS when told to, which a track from another origin needs to load at all', async () => {
    expect((await mount({ src: 'a.mp4' })).hasAttribute('crossorigin')).toBe(false);
    expect((await mount({ src: 'a.mp4', crossorigin: 'anonymous' })).getAttribute('crossorigin')).toBe('anonymous');
  });
});
