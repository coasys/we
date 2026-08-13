/**
 * The screen when there is no app left.
 *
 * Written in raw elements with inline styles, which is not how anything else in this repo is
 * written and is the point. Everything a WE screen normally reaches for — DS primitives, theme
 * tokens, a store to read — is a thing that could be what just failed, and a fallback that fails is
 * a blank page with the cause hidden. This depends on nothing but the DOM.
 *
 * The message is shown rather than hidden behind a "details" affordance. Somebody has to be able to
 * report this, and the first thing anyone will be asked for is what it said.
 */
export function AppFailure(props: { error: unknown }) {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  console.error('[we] the app failed to start:', props.error);

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '16px',
        padding: '32px',
        'min-height': '100vh',
        'font-family': 'system-ui, sans-serif',
        'text-align': 'center',
        background: '#111',
        color: '#eee',
      }}
    >
      <h1 style={{ 'font-size': '20px', margin: 0 }}>WE could not start</h1>
      <p style={{ margin: 0, 'max-width': '48ch', 'line-height': 1.5, opacity: 0.8 }}>{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: '8px 16px',
          'font-size': '14px',
          'border-radius': '6px',
          border: '1px solid #555',
          background: '#222',
          color: '#eee',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  );
}
