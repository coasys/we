/**
 * `tone` paints the family it names, and nothing else changes colour.
 *
 * A tone re-points the accent's roles on an element, so it is a cascade of variables — exactly what
 * a jsdom test can only compare as text. These are the resolved colours: a danger button is the
 * danger fill, a teal one the palette's teal, an untoned soft button stays the grey control it was,
 * and a button inside a toned card draws in the card's family without being told.
 */
export const name = 'tone paints its family';
export const scenario = 'ds:tone';
export const widths = [480];

export async function check({ partStyle, roleColor }) {
  const problems = [];
  const bg = (nth) => partStyle('we-button', 'background-color', 'base', nth);
  const expect = async (nth, role, what) => {
    const got = await bg(nth);
    const want = await roleColor(role);
    if (got !== want) problems.push(`${what} is ${got}, not ${role} (${want})`);
  };

  await expect(0, 'accent', 'an untoned solid button');
  await expect(1, 'danger', 'a danger solid button');
  await expect(2, 'teal', 'a teal solid button');
  await expect(3, 'control-surface', 'an untoned soft button');
  await expect(4, 'success-soft', 'a success soft button');
  await expect(5, 'warning', 'a solid button inside a warning card');

  if ((await bg(1)) === (await bg(0))) problems.push('the danger button is the same colour as the untoned one');
  return problems;
}
