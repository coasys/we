/**
 * The parts of each primitive a theme's CSS may style with `::part()` — the public API of the third
 * tier.
 *
 * A theme reaches most of what it wants through settings: families, type roles and component
 * overrides. What is left — a clip-path, a bevel, an animation — is CSS, and CSS needs somewhere to
 * point. These are the places, and a part listed here is kept: renaming or removing one breaks every
 * theme that styles it, so it is a breaking change and is made like one.
 *
 * Parts a primitive draws that are not listed are internal — a native control hidden behind the
 * styled one, a measuring box — and may change at any time. `INTERNAL_PARTS` names them, with why, so
 * the test that holds this list to the source (`parts.test.ts`) can tell a part somebody forgot to
 * list from one nobody should style.
 */
export const PUBLIC_PARTS: Record<string, readonly string[]> = {
  'we-alert': ['base', 'content', 'dismiss'],
  'we-avatar': ['base', 'img', 'initials', 'icon'],
  'we-badge': ['base'],
  'we-blockquote': ['base'],
  'we-button': ['base', 'spinner'],
  'we-checkbox': ['base', 'control', 'check', 'label'],
  'we-code': ['base'],
  'we-color-picker': ['popover', 'preview', 'swatch', 'palette', 'tabs', 'tab', 'area', 'slider', 'footer'],
  'we-date-picker': [
    'base',
    'display',
    'calendar',
    'calendar-header',
    'month-nav',
    'grid',
    'day-header',
    'day',
    'time',
  ],
  'we-divider': ['base'],
  'we-drawer': ['backdrop', 'base', 'close-button'],
  'we-drop-zone': ['base', 'hint'],
  'we-file-upload': ['base', 'file-list', 'file-item', 'remove'],
  'we-form-field': ['base', 'label', 'control', 'description', 'error'],
  'we-html': ['base'],
  'we-icon-picker': ['trigger', 'popover', 'search', 'tabs', 'tab', 'icon-grid', 'icon-btn', 'emoji-grid', 'emoji-btn'],
  'we-iframe': ['base'],
  'we-image': ['base'],
  'we-input': ['base', 'input'],
  'we-link': ['base'],
  'we-live-cursor': ['base', 'arrow', 'label', 'face', 'name'],
  'we-location-picker': ['base', 'popover', 'map-container', 'footer'],
  'we-markdown': ['base'],
  'we-menu': ['base'],
  'we-menu-group': ['base', 'summary', 'title', 'content'],
  'we-menu-item': ['base'],
  'we-modal': ['backdrop', 'base', 'content', 'close-button'],
  'we-move-handle': ['base'],
  'we-number': ['base'],
  'we-number-input': ['base', 'stepper'],
  'we-pagination': ['base', 'nav', 'page', 'ellipsis'],
  'we-popover': ['content'],
  'we-progress-bar': ['base', 'fill'],
  'we-radio': ['base', 'control', 'dot', 'label'],
  'we-resize-handle': ['base', 'line'],
  'we-scroll-area': ['base', 'content'],
  'we-select': ['base', 'value', 'listbox', 'option', 'group-heading', 'empty'],
  'we-skeleton': ['base'],
  'we-slider': ['base', 'track-wrapper', 'marks', 'mark', 'mark-label', 'value'],
  'we-switch': ['base', 'track', 'thumb', 'on-label', 'off-label'],
  'we-tab': ['base'],
  'we-tabs': ['base'],
  'we-tag': ['base', 'dismiss'],
  'we-text': ['base'],
  'we-textarea': ['base', 'textarea'],
  'we-timestamp': ['base'],
  'we-tooltip': ['tooltip', 'arrow'],
  'we-tree': ['base'],
  'we-tree-item': ['base', 'row', 'caret', 'content', 'children'],
  'we-video': ['base'],
};

/**
 * Parts a primitive draws that a theme should not style, and why each is internal. A name here
 * covers it on every element that does not list it public — `label` is public on a form field and
 * internal inside a picker.
 */
export const INTERNAL_PARTS: Record<string, string> = {
  native: 'the browser control a styled one stands in front of, kept for forms and accessibility',
  'native-button': 'the browser control a styled one stands in front of',
  sizer: 'an invisible box that measures text so a control can size itself',
  'input-wrapper': 'a layout box between a field and its decorations',
  trigger: 'the slot a popover or tooltip is anchored to, which belongs to whoever fills it',
  toggle: 'a picker’s internal open/close control, drawn by the picker',
  'value-label': 'a screen-reader label inside a select’s value',
  reveal: 'the show-password control, whose look is the input’s',
  clear: 'an inline clear control, whose look is its field’s',
  caret: 'an inline disclosure arrow, whose look is its control’s',
  'close-button-wrapper': 'a positioning box around an overlay’s close button',
  'start-button-wrapper': 'a positioning box around an overlay’s leading control',
  start: 'a menu group’s leading slot, filled by whoever uses it',
  end: 'a menu group’s trailing slot, filled by whoever uses it',
  container: 'a sortable’s drop target, which takes the look of what is dropped into it',
  input: 'a toggle control’s hidden native input',
  'mark-line': 'the tick a slider mark draws, sized from the track',
  ticks: 'the slider’s tick layer, laid out from the marks',
  'jump-start': 'a scroll area’s jump control, drawn by the area',
  'jump-end': 'a scroll area’s jump control, drawn by the area',
  'area-thumb': 'a colour picker’s drag handle, positioned by the picker',
  'slider-thumb': 'a colour picker’s drag handle, positioned by the picker',
  apply: 'a colour picker’s footer control',
  cancel: 'a colour picker’s footer control',
  dropper: 'a colour picker’s eyedropper control',
  fields: 'a colour picker’s value fields',
  format: 'a colour picker’s format control',
  formats: 'a colour picker’s format list',
  tokens: 'a colour picker’s token list',
  'time-list': 'a date picker’s time column, laid out by the picker',
  'time-option': 'an entry in a date picker’s time column',
  'time-row': 'a date picker’s time row',
  'time-toggle': 'a date picker’s time switch',
  'emoji-input': 'an icon picker’s emoji field',
  'emoji-input-label': 'an icon picker’s emoji field label',
  'load-more': 'an icon picker’s pager',
  'no-results': 'an icon picker’s empty message',
  placeholder: 'a picker’s empty-state text',
  'preview-icon': 'an icon picker’s preview',
  label: 'a picker’s inline label',
  'pin-icon': 'a location picker’s marker',
  coords: 'a location picker’s coordinate readout',
  confirm: 'a location picker’s confirm control',
  row: 'a tree item’s row box',
  content: 'an inner box a primitive lays out itself',
};
