import StoreProvider from '@solid/providers/StoreProvider';
import TemplateProvider from '@solid/providers/TemplateProvider';
import { ToastContainer } from '@we/components/solid';
import { ErrorBoundary } from 'solid-js';

import { AppFailure } from './components/AppFailure';
import { injectDSInteropStyles } from './dsInterop';

injectDSInteropStyles();

/**
 * The outermost boundary — the last resort, and deliberately the plainest thing in the app.
 *
 * Reaching this means the shell itself failed: not a template, which `TemplateBoundary` catches
 * inside the chrome, but the stores or the chrome that would have rendered the recovery. So the
 * fallback uses no store, no theme token that a broken theme could have removed, and no component
 * that could be the thing that broke. It offers a reload, because there is nothing else honest to
 * offer.
 *
 * It lives here rather than in each host's `index.tsx` so all four hosts get it from one place.
 */
export default function App() {
  return (
    <ErrorBoundary fallback={(error) => <AppFailure error={error} />}>
      <StoreProvider>
        <TemplateProvider />
        <ToastContainer />
      </StoreProvider>
    </ErrorBoundary>
  );
}
