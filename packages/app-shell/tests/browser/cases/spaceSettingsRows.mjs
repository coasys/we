/**
 * A space's settings keep their rows while the store hands out new lists.
 *
 * The store builds `spaceList` and `spaceModuleSettings` afresh on every change, as a memo does —
 * no reconcile, no object held from one answer to the next. Two things a remount would lose, each
 * checked across a change to the row it sits in:
 *
 * - **a half-typed name**, the `$localState` the About tab's name field writes, while the space's
 *   description changes under it (a peer's write) — a remount would put the stored name back;
 * - **a setting's row**, the very element, while that setting's own value changes.
 *
 * Both fail if the renderer draws a store's list by reference instead of keeping its rows by id.
 */
export const name = 'space settings keep their rows when the store rebuilds its lists';
export const scenario = 'space:settings-rows';
export const widths = [480];

export async function check({ type, click, call, evaluate }) {
  const problems = [];

  // The About tab: type into the space's name without saving, mark the field, then change the space.
  await type('we-input input', 'Riverside Gard');
  await evaluate(() => {
    document.querySelector('we-input').__probe = 'name field';
  });
  await call('act', 'describe', 'Somewhere else now');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const name = await evaluate(() => {
    const field = document.querySelector('we-input');
    const fields = [...document.querySelectorAll('we-input, we-textarea')].map((f) => f.value);
    return { kept: field?.__probe === 'name field', value: field?.value, fields };
  });
  if (!name.kept) problems.push('the name field was drawn again when the space changed');
  if (name.value !== 'Riverside Gard') problems.push(`the half-typed name reads "${name.value}" after the change`);
  // The description's own field is seeded from the row, so it shows whether the row followed.
  if (!name.fields.includes('Somewhere else now'))
    problems.push('the new description did not reach its field, so the row did not follow the change');

  // The Features tab: mark the "Record calls" row's switch, then change that setting's value.
  await click('we-tab[key="features"]');
  const found = await evaluate(() => {
    const label = [...document.querySelectorAll('we-text')].find((t) => t.textContent?.trim() === 'Record calls');
    // The nearest box around the label that holds a switch is the setting's own row.
    let box = label?.parentElement;
    while (box && !box.querySelector('we-switch')) box = box.parentElement;
    const toggle = box?.querySelector('we-switch');
    if (toggle) toggle.__probe = 'record switch';
    return { label: Boolean(label), toggle: Boolean(toggle), checked: toggle?.checked };
  });
  if (!found.label || !found.toggle) {
    problems.push(`the Features tab did not draw the "Record calls" setting (${JSON.stringify(found)})`);
    return problems;
  }
  await call('act', 'record', true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const setting = await evaluate(() => {
    const kept = [...document.querySelectorAll('we-switch')].find((s) => s.__probe === 'record switch');
    return { kept: Boolean(kept), checked: kept?.checked };
  });
  if (!setting.kept) problems.push('the setting’s row was drawn again when its value changed');
  else if (!setting.checked) problems.push('the setting’s switch kept its row but not the new value');
  return problems;
}
