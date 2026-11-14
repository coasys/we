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
        `Coasys needs Android System WebView ${reason.floor} or newer. This phone has version ${reason.version}.`,
        'After the update, open Coasys again.',
      ],
      action: { label: 'Update WebView', href: WEBVIEW_STORE_URL },
    };
  }
  return {
    title: 'Coasys didn’t load',
    paragraphs: ['If this keeps happening, reinstall Coasys.'],
    action: { label: 'Try again', href: '/' },
  };
}
