/**
 * The Coasys About page: the site's first screen, inside the app.
 *
 * - The film's frame is 16:9 at any width, before its poster has loaded — offline here, so it never
 *   does — and it keeps that shape when the film replaces the poster, so nothing under it moves.
 * - The headline holds its height while its last part types, so the line under it stays put.
 * - The two buttons sit side by side where there is room, and wrap on a phone.
 *
 * `WE_BROWSER_SHOTS=<dir>` also writes a picture.
 */
export const name = 'the Coasys About page';
export const scenario = 'coasys:about';
export const widths = [1280, 420];

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

export async function check({ measureAll, measureText, evaluate, moveTo, screenshot }, width) {
  const problems = [];
  const frame = async () => {
    const boxes = await evaluate(() =>
      [...document.querySelectorAll('we-image, we-video')].map((el) => {
        // The frame is the nearest ancestor with a box that is not the element's own wrapper.
        let box = el.parentElement;
        while (box && getComputedStyle(box).aspectRatio === 'auto') box = box.parentElement;
        const r = box?.getBoundingClientRect();
        return r ? { w: r.width, h: r.height, y: r.top } : null;
      }),
    );
    return boxes.find(Boolean);
  };

  const before = await frame();
  if (!before) problems.push('no film frame with an aspect ratio');
  else if (!near(before.h, (before.w * 9) / 16)) problems.push(`the frame is ${before.w}×${before.h}, not 16:9`);

  // The headline does not change height as it types: sample it while the phrases change. The `h1` is
  // inside the we-text's shadow root, where `measure` cannot see, so this reads the host — which
  // once made the check pass by measuring nothing.
  const headline = () =>
    evaluate(() => {
      const host = [...document.querySelectorAll('we-text')].find((t) => t.tag === 'h1');
      const r = host?.getBoundingClientRect();
      return r ? { x: r.x, h: r.height } : null;
    });
  const heading = await headline();
  if (!heading) problems.push('no headline');
  const heights = new Set([heading?.h]);
  for (let i = 0; i < 6; i++) {
    await evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
    heights.add((await headline())?.h);
  }
  if (heights.size > 1) problems.push(`the headline's height moved while it typed: ${[...heights].join(', ')}`);

  // The text starts on the page's one column: centred in 1040px, inset 40px (22px on a phone). The
  // inset and the top padding are set at different widths, and a tier that named only the top once
  // wrote the sides as 0 there.
  const inset = Math.max(0, (width - 1040) / 2) + (width >= 640 ? 40 : 22);
  if (heading && !near(heading.x, inset)) problems.push(`the headline starts at x=${heading.x}, not ${inset}`);

  const watch = await measureText('Watch the film', 'we-button');
  const see = await measureText('See the app', 'we-button');
  if (!watch || !see) problems.push('the two buttons are missing');
  else if (width >= 768 && !near(watch.y, see.y, 4)) problems.push('the buttons are not side by side');

  // A status pill is the same height in a card as in the list. A we-text's margin once landed on its
  // inner box as well as on itself, and in a card, whose column has a definite height, the inner box
  // (100% high) grew by it: the pill came out 28px with its words in the top 20.
  const pills = await evaluate(() =>
    [...document.querySelectorAll('we-text')]
      .filter((t) => t.textContent.trim() === 'Works today')
      .map((t) => t.shadowRoot.querySelector('[part=base]').getBoundingClientRect().height),
  );
  if (pills.length !== 2 || Math.abs(pills[0] - pills[1]) > 0.5)
    problems.push(`the "Works today" pills are ${pills.join(' and ')}px tall, not one height`);

  // The site's secondary button: a 2px mint outline round white words, filled mint under the pointer.
  // Mint is read off the solid button beside it, so this follows the theme rather than a hex.
  const buttonStyle = () =>
    evaluate(() => {
      const base = (text) =>
        [...document.querySelectorAll('we-button')]
          .find((b) => b.textContent.includes(text))
          ?.shadowRoot.querySelector('[part=base]');
      const see = getComputedStyle(base('See the app'));
      return {
        mint: getComputedStyle(base('Watch the film')).backgroundColor,
        border: see.borderTopColor,
        width: see.borderTopWidth,
        bg: see.backgroundColor,
        text: see.color,
        size: see.fontSize,
      };
    });
  const rest = await buttonStyle();
  if (rest.width !== '2px' || rest.border !== rest.mint || rest.text !== 'rgb(255, 255, 255)')
    problems.push(`"See the app" rests as ${rest.width} ${rest.border} round ${rest.text}, not 2px mint round white`);
  await moveTo('we-button:has-text("See the app")');
  await evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  const hover = await buttonStyle();
  if (hover.bg === rest.bg || hover.bg !== hover.border)
    problems.push(`"See the app" does not fill under the pointer: ${hover.bg} inside ${hover.border}`);
  // With the site's lighter mint, not the resting one: a hover the same colour as the button beside
  // it is no answer to the pointer.
  // The site's #c1ffdf: lighter than the mint, and much paler — its whiteness is what reads as
  // bright. The derived hover was lighter by 0.05 at the mint's full chroma, and read as no change.
  const oklch = (color) => (/^oklch\(([\d.]+) ([\d.]+)/.exec(color) ?? []).slice(1).map(Number);
  const [mintL, mintC] = oklch(rest.mint);
  const [hoverL, hoverC] = oklch(hover.bg);
  if (!(hoverL - mintL > 0.06 && hoverC < mintC * 0.7))
    problems.push(`"See the app" fills with ${hover.bg}, not the site's paler, lighter mint beside ${rest.mint}`);
  await moveTo('we-text');
  if (rest.size !== '18px') problems.push(`the buttons' words are ${rest.size}, not the site's 18px`);

  /*
    The pointer on something further down the page: scrolled to first, since the pointer cannot reach
    what is below the fold, and every scroller put back after, since the scroll would otherwise carry
    into what this case measures next and into the next width's run.
  */
  const pointAt = async (which) => {
    await evaluate((which) => {
      const el =
        which === 'card'
          ? // Found by its words: the scenario strips the site's addresses, the card's included.
            [...document.querySelectorAll('we-link')].find((l) => l.textContent.includes('The interface layer'))
          : [...document.querySelectorAll('we-image')].find((i) => i.closest('we-button'));
      window.__scrolled = [];
      for (let up = el.parentElement; up; up = up.parentElement) window.__scrolled.push([up, up.scrollTop]);
      el.setAttribute('data-case-target', '');
      el.scrollIntoView({ block: 'center' });
    }, which);
    await moveTo('[data-case-target]');
    await evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
  };
  const pointAway = async () => {
    await evaluate(() => {
      for (const [el, top] of window.__scrolled) el.scrollTop = top;
      document.querySelector('[data-case-target]')?.removeAttribute('data-case-target');
    });
    await moveTo('we-text');
  };

  // A layer card is a link as a whole, ringed in its own colour under the pointer — and only
  // recoloured, so nothing moves. Its coloured top is 4px at rest; it was once dropped, and came
  // back as a 1px line on hover, which shifted the card.
  const card = () =>
    evaluate(() => {
      const link = [...document.querySelectorAll('we-link')].find((l) => l.textContent.includes('The interface layer'));
      const base = link?.shadowRoot.querySelector('[part=base]');
      const style = base && getComputedStyle(base);
      return (
        link && {
          tag: base.tagName,
          border: style.borderRightColor,
          top: style.borderTopColor,
          topWidth: style.borderTopWidth,
          height: base.getBoundingClientRect().height,
          words: link.textContent,
        }
      );
    });
  const cardRest = await card();
  if (!cardRest || cardRest.tag !== 'A' || !cardRest.words.includes('More'))
    problems.push('the We card is not one link round the whole card');
  else {
    if (cardRest.topWidth !== '4px') problems.push(`the We card's coloured top is ${cardRest.topWidth}, not 4px`);
    await pointAt('card');
    const cardHover = await card();
    if (cardHover.border !== cardHover.top || cardHover.border === cardRest.border)
      problems.push(`the We card is not ringed in its colour under the pointer: ${cardHover.border}`);
    if (cardHover.height !== cardRest.height)
      problems.push(`the We card changes size under the pointer: ${cardRest.height} → ${cardHover.height}`);
    await pointAway();
  }

  // One column: the header ends where the film does, so it does not seem to run on past everything
  // under it.
  const edges = await evaluate(() => {
    const pill = [...document.querySelectorAll('we-link')].find((l) => l.label?.startsWith('AD4M on GitHub'));
    const film = [...document.querySelectorAll('we-button')].find((b) => b.label?.startsWith('Play: The Coasys film'));
    let frame = film?.parentElement;
    while (frame && getComputedStyle(frame).aspectRatio === 'auto') frame = frame.parentElement;
    return { pill: pill?.getBoundingClientRect().right, film: frame?.getBoundingClientRect().right };
  });
  if (!near(edges.pill, edges.film)) problems.push(`the header ends at ${edges.pill}, the film at ${edges.film}`);

  // The poster is dimmed, and brightens under the pointer.
  const posterOpacity = () =>
    evaluate(() => {
      const image = [...document.querySelectorAll('we-image')].find((i) => i.closest('we-button'));
      return Number(getComputedStyle(image.shadowRoot.querySelector('[part=base]')).opacity);
    });
  const posterRest = await posterOpacity();
  await pointAt('poster');
  const posterHover = await posterOpacity();
  if (!(posterRest < 1 && posterHover === 1))
    problems.push(`the poster does not brighten under the pointer: ${posterRest} → ${posterHover}`);
  // And fades back when the pointer leaves, rather than snapping: read a moment after it goes, the
  // picture is on its way down, not already there. The pointer goes to the line under the film,
  // which is on screen while the poster is.
  await evaluate(() =>
    [...document.querySelectorAll('we-text')]
      .find((t) => t.textContent.trim().startsWith('Captions on'))
      .setAttribute('data-case-away', ''),
  );
  await moveTo('[data-case-away]');
  const posterLeaving = await posterOpacity();
  if (!(posterLeaving > posterRest + 0.01 && posterLeaving < 1))
    problems.push(`the poster snaps back when the pointer leaves: ${posterLeaving} a moment after`);
  await pointAway();

  await screenshot('coasys-about');

  // Playing the film swaps the poster for the player in the same frame.
  await evaluate(() => [...document.querySelectorAll('we-button')].find((b) => b.label?.startsWith('Play'))?.click());
  await evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const videos = await measureAll('we-video');
  if (!videos.length) problems.push('pressing the poster did not bring up the player');
  const after = await frame();
  if (before && after && !(near(after.h, before.h) && near(after.y, before.y)))
    problems.push(`the frame moved when the film started: ${before.y}/${before.h} → ${after.y}/${after.h}`);

  return problems;
}
