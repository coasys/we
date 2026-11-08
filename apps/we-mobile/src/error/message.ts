import { type ErrorPageReason, WEBVIEW_STORE_URL } from '../webViewFloor';

export interface ErrorMessage {
  title: string;
  paragraphs: string[];
  action: { label: string; href: string };
}

/** What the error page says for each reason it can be showing. */
export function errorMessage(reason: ErrorPageReason): ErrorMessage {
  if (reason.kind === 'webview-too-old') {
    return {
      title: 'Update Android System WebView',
      paragraphs: [
        `Coasys shows WE through Android System WebView. This phone has version ${reason.version}, and WE needs version ${reason.floor} or newer.`,
        'Update Android System WebView in the Play Store, then open Coasys again.',
      ],
      action: { label: 'Update Android System WebView', href: WEBVIEW_STORE_URL },
    };
  }
  return {
    title: 'Coasys could not open WE',
    paragraphs: ['WE’s page did not load. Try again. If it keeps failing, reinstall Coasys.'],
    action: { label: 'Try again', href: '/' },
  };
}
