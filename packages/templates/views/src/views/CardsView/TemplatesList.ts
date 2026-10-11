import type { SchemaNode } from '@we/schema-shared';
import { installedList } from '@we/template-kit';

export const templatesList: SchemaNode = installedList({
  entity: 'Template',
  as: 'template',
  label: 'templates',
  emptyIcon: 'layout',
  avatarIcon: 'layout',
  key: { $: 'template.slug' },
  activeStorePath: 'templateStore.currentTemplate.id',
  applyAction: 'templateStore.switchTemplate',
  defaultField: 'defaultTemplateId',
  refreshAction: 'templateStore.refreshSpaceTemplates',
  // A section copied into the space is placed in Space settings → Sections, never applied.
  sectionWhen: "template.role == 'view'",
});
