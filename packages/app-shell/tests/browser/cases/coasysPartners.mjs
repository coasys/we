/**
 * The partners band on the Coasys About page, between the hero and the app.
 *
 * - The band is the page shading into the app section, not the site's white: beside the indigo, white
 *   read as a hole.
 * - The logos are drawn white, whatever colours their files use, so they read on the dark band.
 * - A logo's corners are square. An image takes the theme's media radius (Glow's is 22px), which cut
 *   into the edges of a logo drawn to its own edges.
 *
 * The harness strips the site's addresses, so each logo is given a stand-in: dark and coloured shapes
 * running to its edges, which shows both the recolour and any clipping in the picture.
 */
export const name = 'the Coasys partners band';
export const scenario = 'coasys:about';
export const widths = [1280];

const STAND_IN = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#1a1c43"/><circle cx="20" cy="20" r="14" fill="#d33"/></svg>',
)}`;

export async function check({ evaluate, screenshot }) {
  const problems = [];
  const seen = await evaluate((standIn) => {
    const all = (root, out = []) => {
      for (const el of root.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) all(el.shadowRoot, out);
      }
      return out;
    };
    const els = all(document);
    const heading = els.find((el) => el.tagName === 'WE-TEXT' && (el.textContent ?? '').trim() === 'Partners');
    heading?.scrollIntoView({ block: 'center' });
    // The logos beside the heading — not the header's, which are links with images too.
    let around = heading?.parentElement;
    while (around && !around.querySelector('we-image')) around = around.parentElement;
    const logos = around ? all(around).filter((el) => el.tagName === 'WE-IMAGE') : [];
    for (const logo of logos) logo.src = standIn;
    // The band is the heading's nearest ancestor painting a background of its own.
    let band = heading?.parentElement;
    while (
      band &&
      getComputedStyle(band).backgroundImage === 'none' &&
      getComputedStyle(band).backgroundColor === 'rgba(0, 0, 0, 0)'
    )
      band = band.parentElement;
    return {
      logos: logos.length,
      band: band && { colour: getComputedStyle(band).backgroundColor, image: getComputedStyle(band).backgroundImage },
      logo: logos.map((logo) => {
        const img = logo.shadowRoot?.querySelector('img');
        // The filter is on the wrapper the renderer puts around a node with `styles`.
        let filtered = logo;
        while (filtered && getComputedStyle(filtered).filter === 'none') filtered = filtered.parentElement;
        return {
          radius: img && getComputedStyle(img).borderRadius,
          filter: filtered ? getComputedStyle(filtered).filter : 'none',
        };
      }),
    };
  }, STAND_IN);
  await new Promise((r) => setTimeout(r, 300));

  if (seen.logos < 8) problems.push(`${seen.logos} partner logos, not the site's eleven`);
  if (!seen.band) problems.push('no band behind the partners');
  else if (/255, 255, 255/.test(seen.band.colour) || !/gradient/.test(seen.band.image))
    problems.push(`the band is ${seen.band.colour} ${seen.band.image}, not the page shading into the app`);
  const round = seen.logo.filter((l) => l.radius !== '0px');
  if (round.length) problems.push(`${round.length} logos have rounded corners (${round[0].radius})`);
  const coloured = seen.logo.filter((l) => !/brightness\(0\) invert\(1\)/.test(l.filter));
  if (coloured.length) problems.push(`${coloured.length} logos are not drawn white (${coloured[0].filter})`);
  await screenshot('coasys-partners');
  return problems;
}
