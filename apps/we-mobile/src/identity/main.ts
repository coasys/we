/**
 * The phone's identity page, `/mobile/identity.html`: the shared identity window over the
 * `DeviceKey` plugin (see `./transport.ts`). WE opens it for a change (`?change=`) or, on a phone
 * of no identity yet, to join one (`?join`), and it goes back to WE (`?back=`) when the change ends.
 * Its own page, built apart from WE's, so no template, module or store code runs beside the screens
 * that add devices and send the master key.
 */
import { runIdentityWindow } from '@we/identity-window';

import { deviceKeyPlugin } from '../../../we-web/src/platform/deviceKey';
import { JOIN_DECLINED_KEY, readKeyHost, rememberKeyHost } from '../../../we-web/src/platform/keyHost';
import { backPath, pageStart, phoneTransport } from './transport';

const back = backPath(location.search, location.origin);
const start = pageStart(location.search);
const plugin = deviceKeyPlugin();

if (!plugin || !start) {
  location.replace(back);
} else {
  const transport = phoneTransport(start, {
    plugin,
    hint: 'Phone',
    ...(start.kind === 'join'
      ? { keyHost: { read: () => readKeyHost(), remember: (url) => rememberKeyHost(url) } }
      : {}),
    leave(outcome) {
      // "Not now" on the join screen: WE's own sign-in, until the person asks to join again.
      if (start.kind === 'join' && outcome === 'cancelled') {
        try {
          localStorage.setItem(JOIN_DECLINED_KEY, String(Date.now()));
        } catch {
          // No storage: WE asks again next time, which is no harm.
        }
      }
      location.replace(back);
    },
  });
  runIdentityWindow(transport);
  // Leaving without Cancel or Done (back, or the app leaving the page): the page is emptied first,
  // then the flow ends and the window is no longer secure. After Cancel or Done this finds nothing.
  addEventListener('pagehide', () => {
    document.body.replaceChildren();
    void transport.gone();
  });
  // The same page brought back from the back-forward cache is empty, and its flow is over.
  addEventListener('pageshow', (event) => {
    if (event.persisted) location.replace(back);
  });
}
