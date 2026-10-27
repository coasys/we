/**
 * One profile page for anybody: someone else's is to read, your own is to edit.
 *
 * - Theirs draws their name, handle and bio, a plain picture, and no form.
 * - Yours draws the pictures you can change and the form under them.
 */
export const name = 'a profile page, theirs and yours';
export const scenario = 'profile:pages';
export const widths = [1280];

export async function check({ evaluate, screenshot }) {
  const problems = [];
  const side = (did) =>
    evaluate((did) => {
      const root = document.querySelector(`[data-profile="${did}"]`);
      const texts = [...root.querySelectorAll('we-text')].map((t) => t.textContent.trim());
      return {
        texts,
        editable: root.querySelectorAll('we-input').length,
        // EditableImage draws an upload control; a plain picture is a we-avatar or we-image.
        avatar: !!root.querySelector('we-avatar'),
      };
    }, did);

  const theirs = await side('did:them');
  if (!theirs.texts.includes('Theodora Fairweather')) problems.push('their name is not on their profile');
  if (!theirs.texts.includes('@theo')) problems.push('their handle is not on their profile');
  if (!theirs.texts.includes('Keeps the bees.')) problems.push('their bio is not on their profile');
  if (theirs.editable) problems.push(`their profile has ${theirs.editable} fields to edit`);
  if (!theirs.avatar) problems.push('their picture is not drawn as a plain avatar');

  const mine = await side('did:me');
  if (!mine.texts.includes('Alexandra Whitfield')) problems.push('your name is not on your profile');
  if (!mine.editable) problems.push('your profile has no form to edit it');
  if (mine.avatar) problems.push('your picture is not one you can change');

  await screenshot?.('profile-pages');
  return problems;
}
