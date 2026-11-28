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
  runIdentityWindow(
    phoneTransport(start, {
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
    }),
  );
}
