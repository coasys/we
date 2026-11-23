import type { DatasetHandle, WorkflowDefinition, WorkflowPort } from '@we/backend-shared';

/**
 * Install a bundle's workflows into one space, each on its own, and say which were refused and why.
 *
 * After the bundle's record types, since a workflow names the types its records are. Installing one
 * the space already has writes only what differs, so setting a space up again changes nothing.
 * Without a workflow port, or a handle for the space, nothing is installed and that is said once:
 * the app's records exist, and nothing moves them.
 */
export async function installBundleWorkflows(
  port: Pick<WorkflowPort, 'install'> | undefined,
  dataset: DatasetHandle | undefined,
  workflows: readonly WorkflowDefinition[],
): Promise<string[]> {
  if (!workflows.length) return [];
  if (!port || !dataset) return ['this space cannot hold workflows, so the app’s workflows are not in it'];
  const problems: string[] = [];
  for (const workflow of workflows) {
    try {
      await port.install(dataset, workflow);
    } catch (error) {
      problems.push(
        `the “${workflow.name}” workflow was refused: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return problems;
}
