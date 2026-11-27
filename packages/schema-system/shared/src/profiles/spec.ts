import { CAPABILITY_PROFILES } from './profiles';
import type { CapabilityProfile, ProfileMember } from './types';

/**
 * The profiles' language-neutral listing, printed from their definitions: the JSON another host's
 * tooling reads, and the same as tables a person reads. Both are generated so the listing cannot
 * say something the definitions do not — the build writes them, and a profile edited without
 * regenerating shows up as a changed tracked file.
 */
export function renderProfileSpec(profiles: readonly CapabilityProfile[] = CAPABILITY_PROFILES): {
  json: string;
  markdown: string;
} {
  return { json: `${JSON.stringify({ profiles }, null, 2)}\n`, markdown: renderMarkdown(profiles) };
}

/** A table cell: code spans for names and types, with the pipes a union type holds escaped. */
const code = (text: string) => `\`${text.replace(/\|/g, '\\|')}\``;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(head: string[], rows: string[][]): string[] {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
}

function args(member: ProfileMember): string {
  if (!member.args?.length) return 'none';
  return member.args.map((arg) => code(`${arg.name}${arg.optional ? '?' : ''}: ${arg.type}`)).join(', ');
}

const events = (member: ProfileMember) => (member.events.length ? member.events.map(code).join(', ') : '—');

function renderMarkdown(profiles: readonly CapabilityProfile[]): string {
  const lines: string[] = [
    '# Capability profiles: members',
    '',
    'Every member of every profile, with its shape, its arguments, its capability group and the change',
    'events it is part of. The normative rules for reading this listing are in [the README](README.md);',
    'the same data, for tooling, is [`profiles.json`](profiles.json).',
    '',
    '| Profile | Namespace | Version | Members |',
    '| --- | --- | --- | --- |',
    ...profiles.map((p) => `| [${p.title}](#${p.id}) | ${code(p.namespace)} | ${p.version} | ${p.members.length} |`),
  ];

  for (const profile of profiles) {
    const state = profile.members.filter((m) => m.kind === 'state');
    const actions = profile.members.filter((m) => m.kind === 'action');
    lines.push(
      '',
      `## ${profile.id}`,
      '',
      `**${profile.title}, version ${profile.version}, written under ${code(profile.namespace)}.** ${profile.description}`,
    );
    if (state.length) {
      lines.push('', '### State', '');
      lines.push(
        ...table(
          ['Member', 'Shape', 'Group', 'Events', 'Holds'],
          state.map((m) => [code(m.path), code(m.shape ?? ''), code(m.group), events(m), cell(m.description)]),
        ),
      );
    }
    if (actions.length) {
      lines.push('', '### Actions', '');
      lines.push(
        ...table(
          ['Member', 'Arguments', 'Group', 'Ambient', 'Events', 'Does'],
          actions.map((m) => [
            code(m.path),
            args(m),
            code(m.group),
            m.ambient ? 'yes' : 'no',
            events(m),
            cell(m.description),
          ]),
        ),
      );
    }
    lines.push('', '### Events', '');
    lines.push(
      ...table(
        ['Event', 'Changes', 'When'],
        profile.events.map((e) => [code(e.name), e.changes.map(code).join(', '), cell(e.description)]),
      ),
    );
  }

  lines.push(
    '',
    '---',
    '',
    'Generated from [`profiles.ts`](../../../packages/schema-system/shared/src/profiles/profiles.ts) by',
    '`pnpm --filter @we/schema-shared generate:profiles`, which the package build runs. Do not edit it by hand.',
    '',
  );
  return lines.join('\n');
}
