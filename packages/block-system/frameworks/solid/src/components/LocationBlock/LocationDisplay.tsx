import { Column, Row } from '@we/components/solid';
import { Show } from 'solid-js';

interface LocationDisplayProps {
  name: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  address: string | undefined;
}

export function LocationDisplay(props: LocationDisplayProps) {
  const hasCoords = () =>
    props.latitude !== undefined &&
    props.longitude !== undefined &&
    !isNaN(Number(props.latitude)) &&
    !isNaN(Number(props.longitude));

  const mapsUrl = () =>
    hasCoords()
      ? `https://www.openstreetmap.org/?mlat=${props.latitude}&mlon=${props.longitude}#map=15/${props.latitude}/${props.longitude}`
      : undefined;

  return (
    <Row class="we-location-block" gap="300" ay="center" p="300" border="1px solid border" r="300">
      <we-icon name="map-pin" size="sm" flex="none" />
      <Column gap="50" flex="1">
        <Show when={mapsUrl()} fallback={<we-text variant="label">{props.name || 'Unknown Location'}</we-text>}>
          <we-link href={mapsUrl()} target="_blank" textDecoration="none" color="accent">
            <we-text variant="label">{props.name || 'Unknown Location'}</we-text>
          </we-link>
        </Show>
        <Show when={props.address}>
          <we-text variant="footnote" color="text-muted">
            {props.address}
          </we-text>
        </Show>
        <Show when={hasCoords()}>
          <we-text variant="footnote" color="text-faint">
            {Number(props.latitude).toFixed(6)}, {Number(props.longitude).toFixed(6)}
          </we-text>
        </Show>
      </Column>
    </Row>
  );
}
