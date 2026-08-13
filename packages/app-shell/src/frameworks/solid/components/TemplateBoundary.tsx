/**
 * What the app does when a template throws.
 *
 * ## Why the app had no answer
 *
 * There was no `ErrorBoundary` anywhere in WE. Solid's default for an uncaught throw during render
 * is to unmount the whole tree, so any error inside a template took the entire window with it —
 * chrome, sidebar, the settings that would have let you switch to a different template. A blank
 * page and no way out.
 *
 * That is a bad default in any app. It is a much worse one here, because the thing that throws is
 * **data somebody else wrote**. A shared space's templates sync in with the space, so visiting a
 * community is enough to render a template you have never seen; `acceptTemplate` refuses the
 * malformed ones, but structural validity is not the same as running without error, and it never
 * will be. Something has to catch the rest.
 *
 * ## Where the boundaries go, and why more than one
 *
 * A boundary is only useful if what survives it is enough to recover from. So they nest:
 *
 * - **Around the template content**, inside the shell. This is the important one: the sidebar, the
 *   settings overlay and the template switcher are all outside it, so the failure is a panel with a
 *   message in it and the app is still an app. The user can switch template, leave the space, or
 *   open settings — the same as if the template had merely been ugly.
 * - **Around each shell overlay**, so a fault in settings or the marketplace does not take the
 *   space you were looking at with it.
 * - **Around the whole app**, as the honest last resort. Reaching it means the shell itself broke,
 *   and there is nothing left to offer but a reload.
 *
 * ## What it does not do
 *
 * It does not retry automatically. A render error is almost always deterministic in its inputs, so
 * retrying re-throws, and Solid's `reset` in a loop is an unresponsive tab rather than a recovery.
 * The reset is offered as a button, because the one case where retrying works — a value that had
 * not arrived yet — is exactly the case where the user pressing it is the signal that time has
 * passed.
 */
import { Column, Row } from '@we/components/solid';
import type { JSX } from 'solid-js';
import { ErrorBoundary } from 'solid-js';

export interface TemplateBoundaryProps {
  /** What broke, in the user's terms: `this space's template`, `settings`. Names the *scope*. */
  what: string;
  /** Offered alongside the message — e.g. a "switch template" control the failure did not remove. */
  action?: JSX.Element;
  children: JSX.Element;
}

/** Reported once per failure. Separate so the fallback stays a pure render. */
function report(what: string, error: unknown) {
  console.error(`[we] ${what} failed to render:`, error);
}

export function TemplateBoundary(props: TemplateBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        report(props.what, error);
        return (
          <Column ax="center" ay="center" gap="400" p="600" width="100%" height="100%" bg="page">
            <we-icon name="warning-circle" size="xl" color="warning" />
            <we-text variant="heading-md" textAlign="center">
              {`Something went wrong in ${props.what}`}
            </we-text>
            <we-text variant="body" textAlign="center" color="neutral-500" maxWidth="var(--we-layout-xs)">
              {/*
                The message, not a stack. A template's author is often not the person looking at it,
                and "Cannot read properties of undefined" tells that person nothing they can act on
                — but it tells the person who *can* fix it exactly what to look for, which is why it
                is here rather than hidden, and why the console gets the whole error.
              */}
              {error instanceof Error ? error.message : String(error)}
            </we-text>
            <Row gap="300" ay="center" wrap>
              <we-button variant="secondary" onClick={reset}>
                Try again
              </we-button>
              {props.action}
            </Row>
          </Column>
        );
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}
