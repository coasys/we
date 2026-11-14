/*
  How a tool call reads in words, and whether it wrote — kept out of the component file so the
  chat's state tests can ask it without pulling a Solid module through a node graph, the same
  reason `signals/aggregate` is its own entry.
*/
import type { AgentStep } from './AgentSteps.types';

/**
 * What a tool call does, in the chat's words: while it runs, then once it has. The backend records
 * only the tool's name, so the wording is ours, and an unknown tool is shown by name.
 */
const STEP_WORDS: Record<string, [doing: string, done: string]> = {
  template_read: ['Reading the template', 'Read the template'],
  template_update: ['Updating the template', 'Updated the template'],
  update_schema: ['Updating the template', 'Updated the template'],
  get_documentation: ['Reading the documentation', 'Read the documentation'],
  describe_perspective: ['Looking at what this space holds', 'Looked at what this space holds'],
  instance_query: ['Looking up records', 'Looked up records'],
  instance_get: ['Reading a record', 'Read a record'],
  instance_create: ['Creating a record', 'Created a record'],
  instance_update: ['Updating a record', 'Updated a record'],
  instance_remove: ['Removing a record', 'Removed a record'],
  instance_transcript: ['Reading a conversation', 'Read a conversation'],
  get_children: ['Reading what a record holds', 'Read what a record holds'],
  query_links: ['Reading links', 'Read links'],
};

export function stepWords(step: AgentStep): string {
  const [doing, done] = STEP_WORDS[step.tool] ?? [`Using ${step.tool}`, `Used ${step.tool}`];
  if (step.outcome === 'stopped') return `${doing} (stopped)`;
  // A failed call did not do what its past tense says.
  if (step.outcome === 'error') return `${doing} failed`;
  return step.outcome === 'running' ? doing : done;
}

/** Whether a step draws in orange: a call that wrote, and finished — a stopped write wrote nothing sure. */
export function isWroteStep(step: AgentStep): boolean {
  return Boolean(step.wrote) && step.outcome === 'ok';
}
