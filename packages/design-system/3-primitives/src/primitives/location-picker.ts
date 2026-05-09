import type { DesignSystemProps } from '@we/design-types';
import { css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { leafletCss } from './leaflet-css';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
  gap: '200',
};

const styles = css`
  :host {
    position: relative;
    min-width: 0;
  }

  [part='trigger'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: var(--we-space-300);
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    background: var(--we-color-neutral-0);
    padding: 0 var(--we-space-300);
    height: var(--we-component-height-md);
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.15s ease;
  }

  [part='trigger']:hover:not([disabled]) {
    border-color: var(--we-color-neutral-400);
  }

  [part='trigger']:focus-visible {
    border-color: var(--we-color-primary-500);
    outline: 2px solid var(--we-color-primary-100);
    outline-offset: -1px;
  }

  [part='pin-icon'] {
    color: var(--we-color-primary-500);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  [part='label'] {
    flex: 1;
    font-size: var(--we-font-size-400);
    color: var(--we-color-neutral-700);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [part='placeholder'] {
    flex: 1;
    font-size: var(--we-font-size-400);
    color: var(--we-color-neutral-400);
  }

  [part='clear'] {
    all: unset;
    cursor: pointer;
    color: var(--we-color-neutral-400);
    display: flex;
    align-items: center;
    line-height: 1;
    padding: 2px;
    border-radius: var(--we-radius-200);
  }

  [part='clear']:hover {
    color: var(--we-color-neutral-600);
    background: var(--we-color-neutral-100);
  }

  [part='popover'] {
    position: fixed;
    z-index: var(--we-z-dropdown, 9999);
    background: var(--we-color-neutral-0);
    border: 1px solid var(--we-color-neutral-200);
    border-radius: var(--we-radius-500);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    width: 420px;
  }

  [part='map-container'] {
    width: 100%;
    height: 260px;
  }

  [part='footer'] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--we-space-300) var(--we-space-400);
    border-top: 1px solid var(--we-color-neutral-100);
    gap: var(--we-space-300);
  }

  [part='coords'] {
    font-size: var(--we-font-size-300);
    color: var(--we-color-neutral-500);
    font-variant-numeric: tabular-nums;
    flex: 1;
  }

  [part='confirm'] {
    all: unset;
    cursor: pointer;
    background: var(--we-color-primary-500);
    color: var(--we-color-neutral-0);
    font-size: var(--we-font-size-300);
    font-weight: 500;
    padding: var(--we-space-200) var(--we-space-400);
    border-radius: var(--we-radius-400);
    transition: background 0.15s ease;
  }

  [part='confirm']:hover {
    background: var(--we-color-primary-600);
  }

  [part='confirm'][disabled] {
    opacity: 0.45;
    pointer-events: none;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-location-picker')
export default class LocationPicker extends DesignSystemElement {
  static styles = [sharedStyles, styles, unsafeCSS(leafletCss)];

  @property({ type: Number }) latitude?: number;
  @property({ type: Number }) longitude?: number;
  @property({ type: String }) placeholder = 'Set location…';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean }) reverseGeocode = true;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;
  /** Pending lat/lng — staged inside the popover before confirming. */
  @state() private _pendingLat?: number;
  @state() private _pendingLng?: number;
  @state() private _geocoding = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _map: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _marker: any = null;
  private _mapDiv: HTMLElement | null = null;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocClick = this._onDocClick.bind(this);
    document.addEventListener('click', this._onDocClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick);
    this._destroyMap();
  }

  private _onDocClick(e: Event) {
    if (!this.contains(e.target as Node)) {
      this._open = false;
      this._destroyMap();
    }
  }

  private _destroyMap() {
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._marker = null;
    }
  }

  private async _initMap() {
    if (this._map || !this._mapDiv) return;

    const L = await import('leaflet');

    const initialLat = this.latitude ?? 20;
    const initialLng = this.longitude ?? 0;
    const initialZoom = this.latitude != null ? 8 : 2;

    this._map = L.map(this._mapDiv, { zoomControl: true }).setView([initialLat, initialLng], initialZoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(this._map);

    // Custom pin icon using a simple data URI — avoids broken icon path issue in Leaflet+bundlers
    const pinIcon = L.divIcon({
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20C24 5.373 18.627 0 12 0z" fill="var(--we-color-primary-500,#6366f1)"/>
        <circle cx="12" cy="12" r="5" fill="white"/>
      </svg>`,
      className: '',
      iconSize: [24, 32],
      iconAnchor: [12, 32],
    });

    // If a value already exists, place marker immediately
    if (this.latitude != null && this.longitude != null) {
      this._pendingLat = this.latitude;
      this._pendingLng = this.longitude;
      this._marker = L.marker([this.latitude, this.longitude], { icon: pinIcon }).addTo(this._map);
    }

    this._map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
      const { lat, lng } = e.latlng;
      this._pendingLat = Math.round(lat * 1e6) / 1e6;
      this._pendingLng = Math.round(lng * 1e6) / 1e6;

      if (this._marker) {
        this._marker.setLatLng([lat, lng]);
      } else {
        this._marker = L.marker([lat, lng], { icon: pinIcon }).addTo(this._map);
      }
      this.requestUpdate();
    });
  }

  private _open_popover() {
    if (this.disabled) return;
    this._pendingLat = this.latitude;
    this._pendingLng = this.longitude;
    this._open = true;
    // Small delay so the shadow DOM div is rendered before initMap reads it
    requestAnimationFrame(() => {
      this._mapDiv = this.shadowRoot?.querySelector('[part="map-container"]') as HTMLElement | null;
      this._initMap().then(() => {
        // Force Leaflet to recalculate container size after layout
        if (this._map) this._map.invalidateSize();
      });
    });
  }

  private async _confirm() {
    if (this._pendingLat == null || this._pendingLng == null) return;

    interface GeocodeResult {
      city?: string;
      countryCode?: string;
      country?: string;
      address?: string;
    }
    let geocodeResult: GeocodeResult = {};

    if (this.reverseGeocode) {
      this._geocoding = true;
      this.requestUpdate();
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${this._pendingLat}&lon=${this._pendingLng}&format=json`,
          { headers: { 'Accept-Language': 'en' } },
        );
        const data = await res.json();
        const addr: Record<string, string> = data.address ?? {};
        geocodeResult = {
          city: addr.city ?? addr.town ?? addr.village ?? undefined,
          countryCode: addr.country_code?.toUpperCase() ?? undefined,
          country: addr.country ?? undefined,
          address: (data.display_name as string) ?? undefined,
        };
      } catch {
        // silent fallback — offline or rate-limited
      } finally {
        this._geocoding = false;
      }
    }

    this.latitude = this._pendingLat;
    this.longitude = this._pendingLng;
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { latitude: this._pendingLat, longitude: this._pendingLng, ...geocodeResult },
        bubbles: true,
        composed: true,
      }),
    );
    this._open = false;
    this._destroyMap();
  }

  private _clear(e: Event) {
    e.stopPropagation();
    this.latitude = undefined;
    this.longitude = undefined;
    this._pendingLat = undefined;
    this._pendingLng = undefined;
    this.dispatchEvent(new CustomEvent('change', { detail: null, bubbles: true, composed: true }));
  }

  private _formatCoords(lat: number, lng: number): string {
    const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
    const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
    return `${latStr}, ${lngStr}`;
  }

  private _popoverPosition(): Record<string, string> {
    const triggerEl = this.shadowRoot?.querySelector('[part="trigger"]') as HTMLElement | null;
    if (!triggerEl) return { top: '0px', left: '0px' };
    const rect = triggerEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow >= 320) {
      return { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
    }
    return { bottom: `${window.innerHeight - rect.top + 4}px`, left: `${rect.left}px` };
  }

  render() {
    const hasValue = this.latitude != null && this.longitude != null;
    const popoverPos = this._open ? this._popoverPosition() : {};

    return html`
      <div part="base" style=${styleMap({ position: 'relative', ...this.styles })}>
        <button
          part="trigger"
          ?disabled=${this.disabled}
          @click=${this._open_popover}
          aria-haspopup="true"
          aria-expanded=${this._open ? 'true' : 'false'}
        >
          <span part="pin-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor">
              <path
                d="M128,16a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,16Zm0,40a40,40,0,1,1-40,40A40,40,0,0,1,128,56Zm0,144a88.1,88.1,0,0,1-71.09-36.14C67.2,143.17,93.67,128,128,128s60.8,15.17,71.09,35.86A88.1,88.1,0,0,1,128,200Z"
              />
            </svg>
          </span>
          ${hasValue
            ? html`<span part="label">${this._formatCoords(this.latitude!, this.longitude!)}</span>`
            : html`<span part="placeholder">${this.placeholder}</span>`}
          ${hasValue
            ? html`
                <button part="clear" @click=${this._clear} title="Clear location" tabindex="0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 256 256"
                    fill="currentColor"
                  >
                    <path
                      d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"
                    />
                  </svg>
                </button>
              `
            : null}
        </button>

        ${this._open
          ? html`
              <div part="popover" style=${styleMap(popoverPos)}>
                <div part="map-container"></div>
                <div part="footer">
                  <span part="coords">
                    ${this._pendingLat != null && this._pendingLng != null
                      ? this._formatCoords(this._pendingLat, this._pendingLng)
                      : 'Click map to place pin'}
                  </span>
                  <button
                    part="confirm"
                    ?disabled=${this._pendingLat == null || this._geocoding}
                    @click=${this._confirm}
                  >
                    ${this._geocoding ? 'Looking up…' : 'Confirm location'}
                  </button>
                </div>
              </div>
            `
          : null}
      </div>
    `;
  }
}
