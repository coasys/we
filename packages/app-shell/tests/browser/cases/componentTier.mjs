/**
 * A theme's component tier and type roles reach what they name, and nothing a node said itself.
 *
 * The first three buttons and the two headings are under no theme; the next five are the same nodes
 * under a node-level theme. Read off the painted parts: an untouched button takes the theme's radius
 * and weight, a soft one its variant's fill, a button with its own `r` keeps it, and both kinds of
 * heading — `we-text` and markdown — take the heading weight. The untouched copy is the pin that a
 * theme setting nothing renders as it always did.
 */
export const name = 'component tier and type roles';
export const scenario = 'ds:component-tier';
export const widths = [480];

export async function check({ partStyle, roleColor }) {
  const problems = [];
  const button = (nth, property) => partStyle('we-button', property, 'base', nth);
  const expect = (what, got, want) => {
    if (got !== want) problems.push(`${what} is ${got}, expected ${want}`);
  };

  // Untouched.
  expect('an unthemed button’s radius', await button(0, 'border-top-left-radius'), '8px');
  expect('an unthemed button’s weight', await button(0, 'font-weight'), '400');
  expect('an unthemed soft button’s fill', await button(1, 'background-color'), await roleColor('control-surface'));
  expect('an unthemed heading’s weight', await partStyle('we-text', 'font-weight', 'base', 0), '700');

  // Themed.
  expect('a themed button’s radius', await button(3, 'border-top-left-radius'), '0px');
  expect('a themed button’s weight', await button(3, 'font-weight'), '700');
  expect('a themed soft button’s fill', await button(4, 'background-color'), await roleColor('danger-soft'));
  expect(
    'a button with its own radius',
    await button(5, 'border-top-left-radius'),
    await button(2, 'border-top-left-radius'),
  );
  expect('a themed heading’s weight', await partStyle('we-text', 'font-weight', 'base', 1), '300');
  return problems;
}
