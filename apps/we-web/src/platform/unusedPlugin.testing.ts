/**
 * For the tests: a `DeviceKey` plugin every method of which refuses, for a test to spread its own
 * answers over. A method a test did not expect to be called fails it loudly rather than answering
 * something plausible.
 */
import type { DeviceKeyPlugin } from './deviceKey';

const METHODS = [
  'status',
  'create',
  'join',
  'waitJoined',
  'signSession',
  'identityStatus',
  'takeMaster',
  'askForMaster',
  'masterWaiting',
  'requests',
  'answer',
  'devices',
  'rename',
  'revoke',
  'scanDevice',
  'linkNext',
  'linkConfirm',
  'linkCancel',
  'scanCode',
] as const satisfies readonly (keyof DeviceKeyPlugin)[];

// Every method of the plugin is named above, so one added to the plugin and not here fails to compile.
type Missing = Exclude<keyof DeviceKeyPlugin, (typeof METHODS)[number]>;
const complete: [Missing] extends [never] ? true : Missing = true;
void complete;

export function unusedPlugin(): DeviceKeyPlugin {
  return Object.fromEntries(
    METHODS.map((name) => [name, () => Promise.reject(new Error(`DeviceKey.${name} was not expected in this test`))]),
  ) as unknown as DeviceKeyPlugin;
}
