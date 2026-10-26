import type { SchemaNode } from '@we/schema-shared';
import { field, formModal, sectionCard } from '@we/template-kit';

/**
 * Who is in this space, and the standings they hold across it — its admins, its moderators, whatever
 * else this community names.
 *
 * A role is a part in the space itself, where an involvement is a part in one record. They sit on a
 * tab of their own rather than under Vocabulary because the question here is about people — who looks
 * after this space — and a community deciding that is not reasoning about its words.
 *
 * ## Why it needs the space open
 *
 * Vocabulary's reason: roles and grants are read from the space's own dataset, so a row in the spaces
 * list that is not the open space cannot answer. It says so and offers to open it.
 *
 * ## Granting is one menu per member
 *
 * A toggle per role, ticked for the roles the member holds. The menu reports a toggle before its tick
 * changes, so a ticked entry is a role to take away and an unticked one a role to give. The one refusal
 * — the last admin cannot lose `admin` — is the store's, and says so in a toast rather than leaving the
 * tick where it was without a word.
 *
 * ## The rules sit with the roles
 *
 * The space's policy names roles — moderators delete anything, admins change the settings — so it is
 * read beside them: which preset the space is on, and each permission as a sentence. Switching preset
 * is offered to whoever the policy lets change it (`can()`), and the store judges the switch again.
 */

const openSpaceFirst: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['People'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: ['Who holds which role is read from the space itself, so this one has to be open to see it.'],
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'soft',
        size: 'sm',
        alignSelf: 'start',
        onClick: { $invoke: 'spaceStore.navigateToSpace', args: [{ $: 'space.uuid' }] },
      },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Open this space'] },
        { type: 'we-icon', props: { name: 'arrow-right' } },
      ],
    },
  ],
};

const createRoleModal: SchemaNode = formModal({
  open: { $: 'local.createRoleOpen' },
  close: { $setLocal: 'createRoleOpen', value: false },
  title: 'New role',
  size: 'sm',
  localState: {
    roleName: { type: 'string', initial: '' },
    roleDescription: { type: 'string', initial: '' },
  },
  children: [
    field({ name: 'roleName', label: 'Name', placeholder: 'Moderator, Steward, Host…' }),
    field({
      name: 'roleDescription',
      label: 'What it means here',
      control: 'textarea',
      // The line a member reads before they grant it to somebody, so it is worth more than the name.
      placeholder: 'What somebody holding it looks after, and what they may do.',
      props: { rows: 2 },
    }),
  ],
  disabled: { $: '!local.roleName' },
  discardWhen: { $: 'local.roleName || local.roleDescription' },
  submitLabel: 'Create',
  submit: {
    $invoke: 'spaceStore.createRole',
    args: [{ name: { $: 'local.roleName' }, description: { $: 'local.roleDescription' } }],
  },
});

/** One role: its name, what it means, and how many hold it. */
const roleRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', width: '100%', py: '300', borderBottom: '1px solid border' },
  children: [
    { type: 'we-icon', props: { name: { $: "role.slug == 'admin' ? 'crown' : 'shield'" }, color: 'text-muted' } },
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'role.name' }] },
        {
          type: '$if',
          props: {
            condition: { $: 'role.description' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: 'role.description' }],
            },
          },
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [{ $: "`${count(role.holders)} ${plural(count(role.holders), 'person', 'people')}`" }],
    },
  ],
};

const rolesSection: SchemaNode = sectionCard({
  title: 'Roles',
  description:
    'The standings people hold across this space. An admin changes the space itself — its settings, its vocabulary, and who holds which role.',
  aside: {
    type: '$if',
    props: {
      condition: { $: 'space.canAdminister' },
      then: {
        type: 'we-button',
        props: { variant: 'soft', size: 'sm', onClick: { $setLocal: 'createRoleOpen', value: true } },
        children: [
          { type: 'we-icon', props: { name: 'plus' } },
          { type: 'we-text', children: ['Add role'] },
        ],
      },
    },
  },
  children: [
    { type: '$each', props: { items: { $: 'spaceStore.roles' }, as: 'role' }, children: [roleRow] },
    // Carries its own `$if` — see `formModal`.
    createRoleModal,
  ],
});

/** One preset the space can be on: chosen, or offered to whoever may change the rules. */
const presetOption = (preset: 'community' | 'open', name: string, description: string): SchemaNode => ({
  type: 'Row',
  props: { gap: '300', ay: 'start', width: '100%', py: '200' },
  children: [
    {
      type: 'we-icon',
      props: {
        name: { $: `spaceStore.policy.preset == '${preset}' ? 'check-circle' : 'circle'` },
        color: { $: `spaceStore.policy.preset == '${preset}' ? 'accent' : 'text-faint'` },
      },
    },
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        { type: 'we-text', props: { fontWeight: '600' }, children: [name] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [description] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: {
          $: `spaceStore.policy.preset != '${preset}' && can({ policy: spaceStore.policy, action: 'Policy.edit' })`,
        },
        then: {
          type: 'we-button',
          props: {
            variant: 'soft',
            size: 'sm',
            onClick: { $invoke: 'spaceStore.setPolicyPreset', args: [preset] },
          },
          children: [{ type: 'we-text', children: ['Use these'] }],
        },
      },
    },
  ],
});

const policySection: SchemaNode = sectionCard({
  title: 'Rules',
  description:
    'What people may do here. Every change anybody makes in this space is checked against them, and one they do not allow is refused with the reason.',
  children: [
    presetOption(
      'community',
      'Community',
      'Members make things and look after their own. Moderators delete anything; admins look after the space and its rules.',
    ),
    presetOption(
      'open',
      'Open',
      'Everybody who has joined may do anything. Admins still decide the rules and the roles.',
    ),
    {
      type: '$if',
      props: {
        condition: { $: 'spaceStore.policy.loaded && !spaceStore.policy.preset' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['This space has rules of its own, set out below.'],
        },
      },
    },
    {
      type: 'Column',
      props: { gap: '100', pt: '300', borderTop: '1px solid border' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'spaceStore.policy.sentences' }, as: 'sentence' },
          children: [{ type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'sentence' }] }],
        },
      ],
    },
  ],
});

/** The roles a member holds, by name, as badges. */
const memberBadges: SchemaNode = {
  type: '$each',
  props: { items: { $: 'spaceStore.memberRoles[member.did] ?? []' }, as: 'held' },
  children: [
    {
      type: 'we-badge',
      props: { size: 'sm' },
      children: [{ $: 'find(spaceStore.roles, { slug: held }).name ?? held' }],
    },
  ],
};

/** An admin's way to change what a member holds: every role, ticked for those they hold. */
const memberRoleMenu: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'space.canAdminister && count(spaceStore.roles)' },
    then: {
      type: 'DropdownMenu',
      props: {
        triggerIcon: 'shield',
        triggerVariant: 'ghost',
        triggerTitle: 'Roles',
        size: 'sm',
        itemSize: 'sm',
        placement: 'bottom-end',
        items: {
          $: "spaceStore.roles.map(r, { type: 'toggle', id: r.slug, label: r.name, checked: r.slug in (spaceStore.memberRoles[member.did] ?? []) })",
        },
        onSelect: {
          $if: {
            condition: { $: 'arg.checked' },
            then: { $invoke: 'spaceStore.revokeRole', args: [{ $: 'arg.id' }, { $: 'member.did' }] },
            else: { $invoke: 'spaceStore.grantRole', args: [{ $: 'arg.id' }, { $: 'member.did' }] },
          },
        },
      },
    },
  },
};

const memberRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', width: '100%', py: '200', borderBottom: '1px solid border' },
  children: [
    { type: 'we-avatar', props: { image: { $: 'member.avatar' }, hash: { $: 'member.did' }, size: 'sm' } },
    {
      type: 'we-text',
      props: { flex: '1', truncate: true },
      children: [{ $: "member.did == me.did ? member.name + ' (you)' : member.name" }],
    },
    { type: 'Row', props: { gap: '100', wrap: true, ay: 'center' }, children: [memberBadges] },
    memberRoleMenu,
  ],
};

const membersSection: SchemaNode = sectionCard({
  title: 'Members',
  description: 'Everyone in this space, and the roles each of them holds here.',
  children: [{ type: '$each', props: { items: { $: 'spaceStore.members' }, as: 'member' }, children: [memberRow] }],
});

export const spacePeopleSection: SchemaNode = {
  type: '$if',
  props: {
    // The row being configured is the dataset currently open — see the docblock.
    condition: { $: 'space.uuid == datasetStore.currentDataset.id' },
    then: {
      type: 'Column',
      props: { gap: '400' },
      $localState: { createRoleOpen: { type: 'boolean', initial: false } },
      children: [membersSection, rolesSection, policySection],
    },
    else: openSpaceFirst,
  },
};
