import type { Browser, BrowserContext, Page } from 'playwright-core';

/** Headless Chrome with a fake camera and microphone; `fakeAudio` is a WAV the microphone plays. */
export function launchBrowser(options?: { fakeAudio?: string; headless?: boolean }): Promise<Browser>;

/** The ad4m-connect version its session keys are stored under. */
export function connectVersion(): string;

export interface Device {
  name: string;
  context: BrowserContext;
  /** A new tab on this device; its console is kept in `logs` under `<name>/<label>`. */
  tab(label: string): Promise<Page>;
  logs: string[];
  close(): Promise<void>;
}

/** A browser profile signed in as `account` on `executor`. */
export function device(
  browser: Browser,
  executor: { url: string },
  account: { email: string; token: string },
  options?: { name?: string; viewport?: { width: number; height: number } },
): Promise<Device>;

/** How many of a page's peer connections are not closed. */
export function openConnections(page: Page): Promise<number>;

/** Each shown video's width and the frames it decoded over `ms`. */
export function videoFlow(page: Page, ms?: number): Promise<Array<{ width: number; frames: number }>>;
