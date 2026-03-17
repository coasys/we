import '@we/block-solid/styles';

import { PerspectiveProxy } from '@coasys/ad4m';
import { BlockComposer } from '@we/block-solid';
import { Column } from '@we/components/solid';
import { JSX } from 'solid-js';

export interface BlockComposerPageProps {
  perspective: PerspectiveProxy;
  class?: string;
  styles?: JSX.CSSProperties;
}

export function BlockComposerPage(props: BlockComposerPageProps) {
  return (
    <Column
      class={`we-block-composer-page ${props.class || ''}`}
      styles={props.styles}
      ax="center"
      bg="ui-25"
      p="500"
      data-we-page
    >
      <we-text size="600">Block composer!!!</we-text>
      <BlockComposer perspective={props.perspective} />
    </Column>
  );
}
