/**
 * Reading JSON somebody typed: forgiving where the meaning is unambiguous, exact about where it is not.
 *
 * The code panel saves what it parses rather than what was typed — the template is written out again
 * from the value — so a trailing comma is accepted at no cost to what is stored. It is also the most
 * common mistake there is: deleting the last item of a list leaves one behind. Nothing else is relaxed.
 * A comment would be dropped on the next save, and single quotes or bare keys would make the panel
 * accept a dialect the AI, the validator and an exported file do not.
 *
 * Everything else is refused with a line, a column and an offset, because "position 228" sends somebody
 * counting characters and V8 does not always give even that.
 */

export type JsonRead =
  | { ok: true; value: unknown; text: string }
  | { ok: false; message: string; offset: number; line: number; column: number };

/**
 * The text with every comma that ends an object or a list replaced by a space.
 *
 * A space rather than nothing, so every offset in the result is the same as in what was typed and an
 * error found in one points at the right character of the other.
 */
export function blankTrailingCommas(text: string): string {
  const out = text.split('');
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch !== ',') continue;
    let next = i + 1;
    while (next < text.length && /\s/.test(text[next])) next++;
    if (text[next] === '}' || text[next] === ']') out[i] = ' ';
  }
  return out.join('');
}

/** Line and column of an offset, both counted from 1. */
export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}

type Problem = { message: string; offset: number };

/** The first place strict JSON goes wrong, or null. Only finds it: parsing is `JSON.parse`'s job. */
export function firstJsonProblem(text: string): Problem | null {
  let i = 0;
  const space = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const fail = (message: string): Problem => ({ message, offset: Math.min(i, text.length) });
  const what = () => (i >= text.length ? 'the end of the text' : `“${text[i]}”`);

  const string = (): Problem | null => {
    i++; // the opening quote
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return null;
      }
      if (ch === '\n') return fail('A string runs on past the end of its line — is a closing quote missing?');
      i += ch === '\\' ? 2 : 1;
    }
    return fail('A string is never closed — is a closing quote missing?');
  };

  const value = (): Problem | null => {
    space();
    const ch = text[i];
    if (ch === '{') return object();
    if (ch === '[') return list();
    if (ch === '"') return string();
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return null;
      }
    }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (number) {
      i += number[0].length;
      return null;
    }
    if (ch === "'") return fail('Strings take double quotes, not single ones');
    return fail(`Expected a value, found ${what()}`);
  };

  const object = (): Problem | null => {
    i++;
    space();
    if (text[i] === '}') {
      i++;
      return null;
    }
    for (;;) {
      space();
      if (text[i] !== '"')
        return fail(
          text[i] === ','
            ? 'Two commas in a row, or one before anything'
            : `Expected a property name in double quotes, found ${what()}`,
        );
      const named = string();
      if (named) return named;
      space();
      if (text[i] !== ':') return fail(`Expected “:” after the property name, found ${what()}`);
      i++;
      const held = value();
      if (held) return held;
      space();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return null;
      }
      return fail(`Expected “,” or “}”, found ${what()} — is a comma missing?`);
    }
  };

  const list = (): Problem | null => {
    i++;
    space();
    if (text[i] === ']') {
      i++;
      return null;
    }
    for (;;) {
      space();
      if (text[i] === ',') return fail('Two commas in a row, or one before anything');
      const item = value();
      if (item) return item;
      space();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return null;
      }
      return fail(`Expected “,” or “]”, found ${what()} — is a comma missing?`);
    }
  };

  const problem = value();
  if (problem) return problem;
  space();
  return i < text.length ? fail(`Unexpected ${what()} after the end — is a bracket closed too early?`) : null;
}

/** Read typed JSON: trailing commas allowed, anything else wrong reported where it is. */
export function readJson(typed: string): JsonRead {
  const text = blankTrailingCommas(typed);
  const problem = firstJsonProblem(text);
  if (problem) return { ok: false, ...problem, ...lineAndColumn(typed, problem.offset) };
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch (error) {
    // The checker and the parser disagreeing is a bug in the checker; say what the parser said.
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid JSON',
      offset: 0,
      line: 1,
      column: 1,
    };
  }
}
