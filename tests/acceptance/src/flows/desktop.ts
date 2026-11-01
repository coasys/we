/**
 * What a person does in the desktop app, step by step, for the scenarios to share. Each function
 * acts through the windows only, and records every secret it sees in the scenario's ledger.
 */
import type { DesktopApp } from '../drivers/desktop.ts';
import { check, type ScenarioContext } from '../scenario.ts';

/** The identity window's title, once it shows this one. */
export async function identityScreen(app: DesktopApp, title: string, timeoutMs = 120_000): Promise<string> {
  return app.waitFor<string>(
    'identity',
    `const t = h.text(); return t.split('\\n').some((line) => line.trim() === ${JSON.stringify(title)}) ? t : '';`,
    timeoutMs,
    `the identity window's screen "${title}"`,
  );
}

/** The account form of a first run: a name and a password typed twice. */
export async function createAccount(app: DesktopApp, ctx: ScenarioContext, name: string): Promise<void> {
  const password = `wallet password ${ctx.world.dir.slice(-6)}`;
  ctx.secrets.add('password', 'the account password', password);
  await app.waitForText('main', 'Make your account', 180_000);
  await app.type('main', 'What people call you', name);
  await app.type('main', 'Password...', password);
  await app.type('main', 'Confirm password...', password);
  await app.press('main', 'Create account');
}

export interface MadeIdentity {
  did: string;
  passphrase: string;
}

/** Words of the BIP-39 English list, for a wrong answer: at least one is never among the 12 words. */
const NOT_THE_WORDS = [
  'zebra',
  'zone',
  'zoo',
  'youth',
  'yellow',
  'year',
  'wrist',
  'wreck',
  'wrap',
  'worry',
  'world',
  'wool',
  'wolf',
];

/**
 * "Make my identity here", from the first-run screen, through the identity window: the 12 words, a
 * wrong answer and then the right two, a passphrase too short and then a good one, and the ready
 * screen. Answers the identity. Pass `step` to run each screen as a step of the scenario.
 */
export async function makeIdentity(
  app: DesktopApp,
  ctx: ScenarioContext,
  step: (
    name: string,
    checks: string[],
    run: () => Promise<void>,
    options?: { shows?: string },
  ) => Promise<void> = async (_n, _c, run) => run(),
): Promise<MadeIdentity> {
  const passphrase = `a long passphrase ${ctx.world.dir.slice(-6)} for the run`;
  ctx.secrets.add('passphrase', 'the custody passphrase', passphrase);
  let words: string[] = [];
  let did = '';

  await step(
    'The first-run screen offers "Make my identity here", and it opens the identity window',
    ['the first run offers to make an identity on this computer'],
    async () => {
      await app.waitForText('main', 'Welcome to Coasys', 180_000);
      await app.press('main', 'Make my identity here');
      await app.waitForWindow('identity', true);
      // The window opens on the words: this step ends on them, so it keeps no screen.
      await identityScreen(app, 'Your 12 words');
    },
    { shows: 'the 12 words' },
  );

  await step(
    'The identity window shows the 12 words, and goes on only once the person says they wrote them down',
    ['the words show on this computer only, in the identity window', 'the person confirms they wrote them down'],
    async () => {
      await identityScreen(app, 'Your 12 words');
      words = await app.eval<string[]>(
        'identity',
        `return [...document.querySelectorAll('.word')].map((w) => w.childNodes[1].textContent.trim());`,
      );
      check(words.length === 12, `the screen shows ${words.length} words, not 12`);
      ctx.secrets.addWords('the 12 words', words);
      const blocked = await app.eval<boolean>(
        'identity',
        `return h.controls('I wrote them down')[0]?.disabled === true;`,
      );
      check(blocked, '"I wrote them down" can be pressed before the person says they understand');
      await app.eval('identity', `h.tick('I understand'); return true;`);
      await app.press('identity', 'I wrote them down');
    },
    { shows: 'the 12 words' },
  );

  await step(
    'Two words are checked: a wrong answer is refused, the right ones go on',
    ['two random words are checked', 'a wrong answer does not go on'],
    async () => {
      const text = await identityScreen(app, 'Check two words');
      const positions = [...text.matchAll(/^Word (\d+)$/gm)].map((m) => Number(m[1]));
      check(
        positions.length === 2 && positions.every((p) => p >= 1 && p <= 12),
        `the screen asks for words ${positions.join(', ')}`,
      );
      const [a, b] = positions;
      // A wrong answer that is no word of the phrase, so the screen after this step shows none of
      // them. Thirteen candidates, so one of them is always outside the 12 words.
      const wrong = NOT_THE_WORDS.find((w) => !words.includes(w)) ?? '';
      check(wrong && !words.includes(wrong), 'no wrong answer outside the phrase');
      await app.type('identity', `Type word ${a}`, wrong);
      await app.type('identity', `Type word ${b}`, words[b - 1]);
      await app.press('identity', 'Confirm');
      const again = await identityScreen(app, 'Check two words');
      const asked = [...again.matchAll(/^Word (\d+)$/gm)].map((m) => Number(m[1]));
      check(asked.join() === positions.join(), 'a wrong answer changed which words are asked for');
      check(!again.includes('Protect your master key'), 'a wrong answer went on');
      await app.type('identity', `Type word ${a}`, words[a - 1]);
      await app.type('identity', `Type word ${b}`, words[b - 1]);
      await app.press('identity', 'Confirm');
      // The step ends once the right answers have left the screen, so its screenshot shows none.
      await identityScreen(app, 'Protect your master key with a passphrase');
    },
  );

  await step(
    'A passphrase protects the master key: a short one is refused',
    ['the master key rests behind a passphrase of 15 characters or more'],
    async () => {
      await identityScreen(app, 'Protect your master key with a passphrase');
      await app.type('identity', 'Passphrase', 'too short');
      await app.type('identity', 'Type it again', 'too short');
      await app.press('identity', 'Continue');
      await identityScreen(app, 'Protect your master key with a passphrase');
      await app.waitFor(
        'identity',
        `return document.querySelector('.error')?.textContent || '';`,
        30_000,
        'the reason a short passphrase is refused',
      );
      await app.type('identity', 'Passphrase', passphrase);
      await app.type('identity', 'Type it again', passphrase);
      await app.press('identity', 'Continue');
    },
  );

  await step(
    'The identity exists: this computer is d1 in its key log',
    ['the identity is made and this computer speaks for it as d1'],
    async () => {
      const ready = await identityScreen(app, 'Your identity exists now', 180_000);
      did = /did:scid:coasys:1:[1-9A-HJ-NP-Za-km-z]+/.exec(ready)?.[0] ?? '';
      check(did, `the ready screen names no identity:\n${ready}`);
      check(
        ready.includes('This computer is d1 in your key log.'),
        'the ready screen does not say this computer is d1',
      );
      await app.press('identity', 'Done');
      await app.waitForWindow('identity', false);
    },
  );

  return { did, passphrase };
}

/** Opens a page of Settings from the gear in the rail. */
export async function openSettings(app: DesktopApp, page: string): Promise<string> {
  await app.waitFor('main', `return h.pressIcon('gear-six');`, 30_000, 'the settings button');
  await app.press('main', page);
  return app.waitForText('main', page);
}

/** The text of a Settings page, from its title on. */
export async function settingsPage(app: DesktopApp, title: string, shows: string, timeoutMs = 60_000): Promise<string> {
  return app.waitFor<string>(
    'main',
    `const t = h.text(); const at = t.lastIndexOf('\\n' + ${JSON.stringify(title)} + '\\n'); if (at < 0) return ''; const page = t.slice(at + 1); return page.includes(${JSON.stringify(shows)}) ? page : '';`,
    timeoutMs,
    `"${shows}" on the ${title} page`,
  );
}
