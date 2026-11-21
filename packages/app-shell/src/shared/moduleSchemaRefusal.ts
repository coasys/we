import { ModuleSchemasRefused } from '@we/backend-shared';

/**
 * A `.catch` for a schema install that reports modules the backend refused, and lets the dataset
 * open anyway.
 *
 * The backend installs each module on its own, so a refusal (`ModuleSchemasRefused`) means the
 * named modules are not installed and everything else is: the space's own schemas and every other
 * module. Failing the whole operation for it would make one module's clash with another app close
 * a space to everyone who has that module on. Any other error is the install itself failing, and
 * is thrown on.
 */
export function reportModuleRefusal(where: string): (error: unknown) => void {
  return (error) => {
    if (!(error instanceof ModuleSchemasRefused)) throw error;
    console.error(`${where}: module schemas refused`, error);
  };
}
