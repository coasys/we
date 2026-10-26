/**
 * themeToolset — reading and editing a stored Theme record, as tools any agent on a host can be
 * offered, and the theming reference as the documentation it reads first.
 *
 * The template toolset's sibling, on the same terms: nothing is held between calls, a refused call
 * answers with text starting `Error: `, and an update names the `version` it was written against so
 * a theme that moved on since it was read is not edited blind.
 *
 * A theme is settings, not a stylesheet, so an update is a merge of settings rather than a patch to a
 * tree: the keys given replace the stored ones, `null` removes one, and the settings that are maps of
 * their own (`roles`, `typeStyles`, `components`, `palette`, `surfaceImages`) merge one level deeper,
 * so pinning one role does not drop the rest. The merged theme is checked against the same vocabulary
 * a node's `theme` is, and refused with the names that exist when it uses one that does not.
 *
 * The CSS is not sanitised here: that needs a browser's parser, and the app sanitises every sheet as
 * it applies it. What the app would silently drop — `@import` and a `url()` that fetches — is refused
 * instead, so an agent learns why rather than wondering where its rule went.
 */
import { parseOverrides, THEME_SCHEMA_VERSION, type ThemeOverrides, validateStructure } from '@we/schema-shared';
import { SPECIAL_SETTINGS, THEME_SETTINGS, themingReference } from '@we/themes/presets';

import { type AgentTool, readArguments, type RecordInput, type RecordToolset, type ToolCall } from '../core/toolset';

export const THEME_READ = 'theme_read';
export const THEME_UPDATE = 'theme_update';

/** The settings that are maps of their own, merged one level deeper than the rest. */
const NESTED = new Set(['roles', 'typeStyles', 'components', 'palette', 'surfaceImages']);

/** Every name a theme may set, for the message that refuses one it may not. */
const SETTING_NAMES = [...Object.keys(THEME_SETTINGS), ...SPECIAL_SETTINGS].filter((key) => key !== 'schemaVersion');

// ── The file properties, as the app writes and reads them ──────────────────

function fromBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** A file property as text, however the host hands it over: a data URI, the FileData, the text itself. */
function fileText(value: unknown): string {
  if (typeof value === 'string') {
    if (!value.startsWith('data:')) return value;
    const marker = value.indexOf(';base64,');
    return marker < 0 ? '' : fromBase64(value.slice(marker + ';base64,'.length));
  }
  if (value && typeof value === 'object' && typeof (value as { data_base64?: unknown }).data_base64 === 'string')
    return fromBase64((value as { data_base64: string }).data_base64);
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

/** Text as the FileData a file property is written with — the encoding `ThemeStore` uses. */
function fileData(content: string, name: string, type: string) {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data_base64: btoa(binary), name, file_type: type };
}

function readRecord(record: RecordInput | undefined) {
  if (!record) throw new Error('The theme tools work on a Theme record, and none was given.');
  if (!themeToolset.appliesTo.includes(record.className))
    throw new Error(`The theme tools work on Theme records, not ${record.className}.`);
  return {
    name: String(record.properties.name ?? ''),
    version: Number(record.properties.version) || 1,
    overrides: parseOverrides(fileText(record.properties.overrides) || null),
    css: fileText(record.properties.css),
  };
}

// ── What an update may say ──────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The stored settings with the given ones laid over them — `null` removes a key, at either depth. */
export function mergeOverrides(stored: ThemeOverrides, given: Record<string, unknown>): ThemeOverrides {
  const next: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(given)) {
    if (value === null) delete next[key];
    else if (NESTED.has(key) && isObject(value) && isObject(next[key])) {
      const inner: Record<string, unknown> = { ...(next[key] as Record<string, unknown>) };
      for (const [k, v] of Object.entries(value)) {
        if (v === null) delete inner[k];
        else inner[k] = v;
      }
      next[key] = inner;
    } else next[key] = value;
  }
  return next as ThemeOverrides;
}

/** Why the settings cannot be saved, or undefined when they can. */
function overridesProblem(overrides: ThemeOverrides): string | undefined {
  const unknown = Object.keys(overrides).filter((key) => key !== 'schemaVersion' && !SETTING_NAMES.includes(key));
  if (unknown.length)
    return `${unknown.map((k) => `\`${k}\``).join(', ')} ${unknown.length === 1 ? 'is not a theme setting' : 'are not theme settings'}. The settings are: ${SETTING_NAMES.join(', ')}.`;
  // Checked the way a node's `theme` is, so the tools accept exactly what a template may carry.
  const checked = validateStructure({ type: 'Column', theme: overrides });
  if (checked.valid) return undefined;
  return checked.errors
    .map((error) => `${error.path.replace(/^theme\.?/, '') || 'theme'}: ${error.message}`)
    .join('; ');
}

/** Why the CSS would not do what it says once the app applies it, or undefined. */
function cssProblem(css: string): string | undefined {
  if (/@import\b/i.test(css))
    return '`@import` is removed when a theme is applied: it would fetch, telling a third party who opened the space, and could change the theme after it was installed. Write the rules into the sheet.';
  const fetching = [...css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)].find(
    (match) => !match[2].trim().startsWith('data:'),
  );
  if (fetching || /image-set\s*\(/i.test(css))
    return '`url()` that is not a `data:` URL is removed when a theme is applied: it would fetch, telling a third party who opened the space. Carry fonts in the `fontFaces` setting, and draw backgrounds with gradients (`surfaceImages`).';
  return undefined;
}

// ── The tools ───────────────────────────────────────────────────────────────

const readTool: AgentTool = {
  name: THEME_READ,
  description:
    'Read the theme being edited: its name, its version, its settings and its CSS. Read the `theme` ' +
    'documentation topic before a first edit — it lists every setting and what each does.',
  parameters: { type: 'object', properties: {} },
  writes: false,
};

const updateTool: AgentTool = {
  name: THEME_UPDATE,
  description:
    'Change the theme and SAVE it. `overrides` is merged into the stored settings: a key given replaces ' +
    'the stored one, `null` removes it, and roles, typeStyles, components, palette and surfaceImages ' +
    `merge one level deeper. \`css\` replaces the whole sheet. Pass the version ${THEME_READ} gave: a theme ` +
    'that has changed since is refused. Prefer a setting to CSS wherever one says it.',
  parameters: {
    type: 'object',
    properties: {
      version: { type: 'number', description: `The version ${THEME_READ} answered with.` },
      overrides: { type: 'object', description: 'Settings to set, or null to remove.' },
      css: { type: 'string', description: 'The whole stylesheet, replacing the stored one. Empty removes it.' },
    },
    required: ['version'],
  },
  writes: true,
};

function read({ record }: ToolCall): string {
  const { name, version, overrides, css } = readRecord(record);
  return JSON.stringify({ name, version, overrides, css });
}

function update({ record, args }: ToolCall) {
  const parsed = readArguments(args);
  if (!parsed) return { text: `Error: The arguments to ${THEME_UPDATE} must be a JSON object.` };
  const stored = readRecord(record);

  if (parsed.version === undefined)
    return {
      text: `Error: Pass the version ${THEME_READ} answered with, so a theme that has changed is not edited blind.`,
    };
  if (Number(parsed.version) !== stored.version)
    return {
      text:
        `Error: The theme has changed since it was read — it is version ${stored.version} now, and this edit ` +
        `was written against version ${parsed.version}. Read it again with ${THEME_READ} and write the edit ` +
        'against what it says now.',
    };
  if (parsed.overrides !== undefined && !isObject(parsed.overrides))
    return { text: 'Error: `overrides` must be an object of settings.' };
  if (parsed.css !== undefined && typeof parsed.css !== 'string') return { text: 'Error: `css` must be a string.' };
  if (parsed.overrides === undefined && parsed.css === undefined)
    return { text: 'Error: Neither `overrides` nor `css` was given, so there is nothing to change.' };

  const changed: string[] = [];
  const properties: Record<string, unknown> = { version: stored.version + 1 };

  if (isObject(parsed.overrides)) {
    const merged = { ...mergeOverrides(stored.overrides, parsed.overrides), schemaVersion: THEME_SCHEMA_VERSION };
    const problem = overridesProblem(merged);
    if (problem) return { text: `Error: ${problem}` };
    properties.overrides = fileData(JSON.stringify(merged), 'overrides.json', 'application/json');
    const keys = Object.keys(parsed.overrides);
    const removed = keys.filter(
      (key) => parsed.overrides && (parsed.overrides as Record<string, unknown>)[key] === null,
    );
    const set = keys.filter((key) => !removed.includes(key));
    if (set.length) changed.push(`set ${set.join(', ')}`);
    if (removed.length) changed.push(`removed ${removed.join(', ')}`);
  }

  if (typeof parsed.css === 'string') {
    const problem = cssProblem(parsed.css);
    if (problem) return { text: `Error: ${problem}` };
    properties.css = parsed.css.trim() ? fileData(parsed.css, 'theme.css', 'text/css') : null;
    changed.push(parsed.css.trim() ? 'replaced the CSS' : 'removed the CSS');
  }

  return { text: `Saved as version ${stored.version + 1}: ${changed.join('; ')}.`, properties };
}

const DOC_PATH = 'theme';
const docText = () =>
  [
    `Two tools edit a theme: \`${THEME_READ}\` reads its settings and CSS, and \`${THEME_UPDATE}\` merges ` +
      'settings into it and saves. Read the theme first, change as little as says it, and reach for a ' +
      'setting before CSS: settings are corrected for contrast wherever the theme lands, and CSS is not.',
    '',
    themingReference(1),
  ].join('\n');

export const themeToolset: RecordToolset = {
  appliesTo: ['Theme'],
  tools: [readTool, updateTool],

  async call(name, input) {
    if (name === THEME_READ) return { text: read(input) };
    if (name === THEME_UPDATE) return update(input);
    return { text: `Error: Unknown tool: ${name}` };
  },

  docs: {
    list: async () => [
      {
        path: DOC_PATH,
        title: 'Theming',
        summary: 'Every setting a theme can set, and how to edit one with these tools.',
      },
    ],
    read: async (path) => (path === DOC_PATH ? docText() : undefined),
  },
};
