import './page.css';

/**
 * `/o`: an offer link. The page hands the whole link to the Coasys app through `coasys://link` and
 * shows, posts and stores nothing of it.
 */
export function appLink(search: string, hash: string): string {
  return `coasys://link${search}${hash}`;
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  location.replace(appLink(location.search, location.hash));
  document.getElementById('app')!.textContent = 'Opening Coasys…';
}
