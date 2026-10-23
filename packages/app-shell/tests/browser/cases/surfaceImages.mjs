/**
 * A theme's surface images are worn by every surface of their kind, and only where nothing says
 * otherwise; the page's holds still. And the theme's surface opacity reaches a card, which it had
 * not since the card's style moved to background longhands.
 */
export const name = 'surface images';
export const scenario = 'ds:surface-images';
export const widths = [420];

export async function check({ partStyle }) {
  const problems = [];
  const image = (selector, part = 'nothing') => partStyle(selector, 'background-image', part);
  const expect = (what, got, want) => {
    if (!got || !got.includes(want)) problems.push(`${what}: ${got}`);
  };

  expect('the page wears the page image', await image('#page'), 'rgb(255, 0, 0)');
  if ((await partStyle('#page', 'background-attachment', 'nothing')) !== 'fixed') {
    problems.push('the page image scrolls with the content');
  }
  expect('a surface wears the surface image', await image('#surface'), 'rgb(0, 255, 0)');
  expect('a card wears the surface image', await image('#card'), 'rgb(0, 255, 0)');
  expect('an element’s own image wins', await image('#own'), 'rgb(0, 0, 0)');
  expect('a menu wears the raised image', await image('we-menu', 'base'), 'rgb(0, 0, 255)');

  const cardFill = await partStyle('#card', 'background-color', 'nothing');
  if (!/\/ 0\.5\)|, 0\.5\)/.test(cardFill))
    problems.push(`the card is not at the theme's surface opacity: ${cardFill}`);
  return problems;
}
