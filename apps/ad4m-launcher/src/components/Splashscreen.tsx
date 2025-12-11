import { Show } from 'solid-js';

interface SplashscreenProps {
  show: boolean;
}

export function Splashscreen(props: SplashscreenProps) {
  return (
    <Show when={props.show}>
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        'background-color': '#1a1a1a',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        'z-index': 9999,
      }}>
        <div style={{
          'text-align': 'center',
        }}>
          <h1 style={{
            color: 'white',
            'font-size': '2rem',
            'margin-bottom': '2rem',
          }}>
            WE
          </h1>
          <div style={{
            color: '#888',
            'font-size': '1rem',
          }}>
            Starting AD4M Executor...
          </div>
          <div style={{
            width: '200px',
            height: '4px',
            'background-color': '#333',
            'border-radius': '2px',
            'margin-top': '2rem',
            overflow: 'hidden',
          }}>
            <div style={{
              width: '50%',
              height: '100%',
              'background-color': '#4a9eff',
              animation: 'loading 1.5s ease-in-out infinite',
            }} />
          </div>
        </div>
        <style>{`
          @keyframes loading {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(200%); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>
    </Show>
  );
}
