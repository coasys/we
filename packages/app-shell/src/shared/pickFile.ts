/**
 * Asks the person for one file. A browser opens its file dialog only from a click it is still
 * handling, so call this straight from the click that asked.
 *
 * Resolves `null` when the dialog is closed without a choice.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
