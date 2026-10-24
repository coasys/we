/**
 * Theme settings reach every component that draws what they name.
 *
 * Each of these reached some components and not others before: the border width moved buttons and
 * left fields, the disabled opacity faded buttons and nothing else, icons had no theme weight at all,
 * and hover and selection were four colours across four list components. Read off painted parts under
 * one node-level theme that sets each to a value nothing else uses.
 */
export const name = 'settings reach every component';
export const scenario = 'ds:settings-reach';
export const widths = [480];

export async function check({ partStyle, prop, hover }) {
  const problems = [];
  const expect = (what, got, want) => {
    if (got !== want) problems.push(`${what} is ${got}, expected ${want}`);
  };
  const RED = 'rgb(255, 0, 0)';
  const BLUE = 'rgb(0, 0, 255)';

  expect('a field’s border', await partStyle('we-input', 'border-top-width', 'base', 0), '3px');
  expect('an outline button’s border', await partStyle('we-button', 'border-top-width', 'base', 0), '3px');
  expect('a disabled button', await partStyle('we-button', 'opacity', 'nothing', 1), '0.2');
  expect('a disabled checkbox', await partStyle('we-checkbox', 'opacity', 'nothing', 0), '0.2');
  expect('an icon’s weight', await prop('we-icon', 'drawnWeight', 0), 'bold');

  expect('a chosen menu item', await partStyle('we-menu-item', 'background-color', 'base', 1), RED);
  expect('the current page', await partStyle('we-pagination', 'background-color', "[aria-current='page']", 0), RED);
  expect('a chosen tab', await partStyle('we-tab', 'background-color', 'base', 1), RED);
  expect('a chosen tree row', await partStyle('we-tree-item', 'background-color', 'row', 0), RED);

  await hover('we-menu-item', 0);
  // The state arrives over the theme's state duration; read it once it has.
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect('a menu item under the pointer', await partStyle('we-menu-item', 'background-color', 'base', 0), BLUE);
  return problems;
}
