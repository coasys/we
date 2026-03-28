import { onMount } from 'solid-js';

export type * from './RerenderLog.types';
import type { RerenderLogProps } from './RerenderLog.types';

export function RerenderLog(props: RerenderLogProps) {
  onMount(() => console.log('Re-mounted in: ', props.location));

  return <div style={{ width: '10px', height: '10px', background: 'red' }} />;
}
