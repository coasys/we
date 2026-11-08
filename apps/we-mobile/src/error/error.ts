/**
 * The page Capacitor opens instead of WE: below the WebView floor, or when WE's page fails to load.
 * It does not use Capacitor's plugins, but it is not isolated from them: it shares the app's origin
 * and native bridge, so it must never render anything a third party supplies. It must run on
 * WebViews WE's bundle does not, so it is plain DOM. An https link out of the app opens
 * in the Play Store: Capacitor hands navigation to other hosts to the system.
 */
import { errorReason } from '../webViewFloor';
import { errorMessage } from './message';

const message = errorMessage(errorReason(navigator.userAgent));
const main = document.getElementById('message');
if (main) {
  const title = document.createElement('h1');
  title.textContent = message.title;
  main.append(title);
  for (const text of message.paragraphs) {
    const p = document.createElement('p');
    p.textContent = text;
    main.append(p);
  }
  const action = document.createElement('a');
  action.className = 'button';
  action.href = message.action.href;
  action.textContent = message.action.label;
  main.append(action);
}
