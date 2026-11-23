/**
 * Setting a space up for an app, in the one order it has to happen in, whoever asks for it.
 *
 * "Set up a space…" in Settings and a space made from an app's starter both do it. Each step is the
 * caller's (where the record types are stored, which port installs workflows, whether sections are
 * copied), and the order and the stopping are this function's:
 *
 * 1. the record types, which everything after them is about;
 * 2. the workflows, which name those types;
 * 3. the rest: sections copied in and switched on.
 *
 * A step that finds problems stops the ones after it, so a space never has an app's sections
 * reading types it refused. A step that throws is a problem like any other, said in a sentence: the
 * space exists by now, and failing whatever asked for the set-up (a create dialog, say) would tell
 * somebody that a space they can see was not made.
 */
export interface AppSetUpSteps {
  addRecordTypes: () => Promise<string[]>;
  installWorkflows: () => Promise<string[]>;
  /** Once both are in: whatever makes the app visible in the space. */
  finish: () => Promise<void>;
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function setUpForApp(steps: AppSetUpSteps): Promise<string[]> {
  const run = async (step: () => Promise<string[]>, what: string): Promise<string[]> => {
    try {
      return await step();
    } catch (error) {
      return [`${what} failed: ${said(error)}`];
    }
  };
  const types = await run(steps.addRecordTypes, 'adding its record types');
  if (types.length) return types;
  const workflows = await run(steps.installWorkflows, 'installing its workflows');
  if (workflows.length) return workflows;
  return run(async () => {
    await steps.finish();
    return [];
  }, 'switching its sections on');
}
