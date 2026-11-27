// The renderer recorder reaches into app-shell, ten of whose files read `import.meta.env`; its types
// come from Vite's client declarations, which only app-shell depends on.
import '../../../../app-shell/node_modules/vite/client.d.ts';
import 'solid-js';

// The probe components draw these two elements; see renderRecorder.tsx.
declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'x-probe': { 'attr:data-type': string; ref?: unknown; children?: JSX.Element };
      'x-probe-slot': { 'attr:data-name': string; children?: JSX.Element };
    }
  }
}
