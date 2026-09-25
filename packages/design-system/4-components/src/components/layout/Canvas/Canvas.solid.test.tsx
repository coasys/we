/**
 * A canvas is arithmetic over a measurement, and every one of these is that arithmetic.
 *
 * Rendered rather than unit-tested because the measurement is the component: the scale is a
 * function of a box nothing knows until a `ResizeObserver` reports one, so a test that called a
 * pure function would be testing the half that was never in doubt. `ResizeObserver` does not exist
 * in jsdom, which is convenient — the fake below is the only one in play, so firing it *is* the
 * resize.
 */
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Canvas } from './Canvas.solid';

type Report = (box: { width: number; height: number }) => void;

let resize: Report | undefined;
let dispose: (() => void) | undefined;

beforeEach(() => {
  const observers: { callback: ResizeObserverCallback; target?: Element }[] = [];
  class FakeResizeObserver {
    private entry: { callback: ResizeObserverCallback; target?: Element };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.target = target;
    }
    disconnect() {
      observers.splice(observers.indexOf(this.entry), 1);
    }
    unobserve() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;

  resize = (box) => {
    for (const { callback, target } of observers) {
      callback(
        [
          {
            contentBoxSize: [{ inlineSize: box.width, blockSize: box.height }],
            target,
          } as unknown as ResizeObserverEntry,
        ],
        undefined as unknown as ResizeObserver,
      );
    }
  };
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  resize = undefined;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  document.body.innerHTML = '';
});

function mount(node: () => ReturnType<typeof Canvas>): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(node, host);
  return host;
}

const artboard = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-we-artboard]')!;
const box = (host: HTMLElement) => host.firstElementChild as HTMLElement;

describe('Canvas', () => {
  it('declares the coordinate space as a real box, at the size it was given', () => {
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} />);
    expect(artboard(host).style.width).toBe('1200px');
    expect(artboard(host).style.height).toBe('3000px');
    // Positioned, so an `x`/`y` inside it — or anything absolute — resolves against this and not
    // against whatever ancestor happened to be positioned.
    expect(artboard(host).style.position).toBe('relative');
  });

  it('puts the children inside the artboard, not beside it', () => {
    const host = mount(() => (
      <Canvas artboard={{ width: 100, height: 100 }}>
        <span id="scrap">a photo</span>
      </Canvas>
    ));
    expect(artboard(host).querySelector('#scrap')).not.toBeNull();
  });

  it('scales to the width it is given, and takes the height that implies', () => {
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} />);
    resize!({ width: 600, height: 0 });

    expect(artboard(host).style.transform).toBe('translate(0px, 0px) scale(0.5)');
    // The property that makes a tall scrapbook behave like a page: the box is as tall as the
    // artboard turned out to be here, so the document scrolls it rather than clipping it.
    expect(box(host).style.height).toBe('1500px');
  });

  it('does nothing until it has been measured', () => {
    // Answering with a scale of zero would collapse the artboard to a point and then spring it
    // open. One frame at natural size is the lesser of the two.
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} />);
    expect(artboard(host).style.transform).toBe('');
  });

  it('fits both axes and centres what is left over, under contain', () => {
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} fit="contain" height="600px" />);
    resize!({ width: 600, height: 600 });

    // Height is the binding axis: 600/3000 is smaller than 600/1200, so 0.2 and pillarboxed.
    expect(artboard(host).style.transform).toBe('translate(180px, 0px) scale(0.2)');
  });

  it('scales by width when contain has no second axis to fit against', () => {
    // A canvas in document flow has no height until something gives it one, and "fit it" with one
    // axis available means that axis — not zero, and not nothing.
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} fit="contain" />);
    resize!({ width: 600, height: 0 });

    expect(artboard(host).style.transform).toBe('translate(0px, 0px) scale(0.5)');
    expect(box(host).style.height).toBe('1500px');
  });

  it('distorts on purpose under stretch', () => {
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} fit="stretch" height="600px" />);
    resize!({ width: 600, height: 600 });

    expect(artboard(host).style.transform).toBe('translate(0px, 0px) scale(0.5, 0.2)');
  });

  it('leaves the artboard at its declared size under none', () => {
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} fit="none" />);
    resize!({ width: 600, height: 0 });

    expect(artboard(host).style.transform).toBe('');
    expect(artboard(host).style.width).toBe('1200px');
  });

  it('clips by default, because the two boxes disagree on purpose', () => {
    // The artboard's *layout* size is its declared size at any scale, so below 1 it overflows the
    // measured box — invisibly, but enough for a scrollbar and a sideways drift.
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} />);
    expect(box(host).style.overflow).toBe('hidden');
  });

  it('does not overrule a height the caller asked for', () => {
    const host = mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} height="400px" />);
    resize!({ width: 600, height: 400 });

    expect(box(host).style.height).toBe('400px');
  });

  it('reports the box and the scale it settled on', () => {
    // The number a manipulation layer has to divide a pointer delta by. Getting it from anywhere
    // else is how the two drift apart.
    const seen: { width: number; height: number; scale: number }[] = [];
    mount(() => <Canvas artboard={{ width: 1200, height: 3000 }} onMeasure={(m) => seen.push(m)} />);
    resize!({ width: 600, height: 0 });

    expect(seen).toEqual([{ width: 600, height: 0, scale: 0.5 }]);
  });

  it('survives an artboard nobody filled in', () => {
    // `artboard` is required, but a template computing it from data can hand over a half-resolved
    // one for a frame, and a NaN in a transform takes the whole declaration with it.
    const host = mount(() => <Canvas artboard={{ width: 0, height: 0 }} />);
    resize!({ width: 600, height: 0 });

    expect(artboard(host).style.transform).toBe('');
    expect(artboard(host).style.width).toBe('');
  });
});
