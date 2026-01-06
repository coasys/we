# Link Scraping Strategy for WE

## Overview

Strategy for implementing link metadata scraping across Tauri and Electron apps with shared parsing logic.

## Architecture 🎯

**Create a shared package with platform-agnostic parsing, but keep platform-specific implementations in each app.**

### Package Structure

```
@we/link-scraper (new package)
├── /core
│   ├── MetadataExtractor.ts    # Pure parsing logic
│   ├── types.ts                # Shared types
│   └── cache.ts                # Optional cache interface
├── /tauri
│   └── index.ts                # Tauri-specific bindings (thin wrapper)
├── /electron
│   └── index.ts                # Electron-specific bindings (thin wrapper)
└── /models
    └── LinkBlock.ts            # Move from @we/models if link-specific

packages/models/
└── Block.ts                    # Keep base Block model here
```

## Implementation

### 1. Core Package - Platform Agnostic Parsing

```typescript
// packages/link-scraper/src/core/types.ts
export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
}

export interface HTMLDocument {
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Element[];
  textContent: string;
}

export interface Element {
  getAttribute(name: string): string | null;
  textContent: string;
}
```

```typescript
// packages/link-scraper/src/core/MetadataExtractor.ts
export class MetadataExtractor {
  /**
   * Extract metadata from HTML string or parsed document
   * Platform-agnostic: works with cheerio, scraper crate output, or DOM
   */
  static extract(doc: HTMLDocument, url: string): LinkMetadata {
    const getMeta = (selectors: string[]): string | undefined => {
      for (const selector of selectors) {
        const content = doc.querySelector(selector)?.getAttribute('content');
        if (content?.trim()) return content.trim();
      }
      return undefined;
    };

    const getLink = (selectors: string[]): string | undefined => {
      for (const selector of selectors) {
        const href = doc.querySelector(selector)?.getAttribute('href');
        if (href) return this.resolveUrl(href, url);
      }
      return undefined;
    };

    return {
      url,

      // Title
      title:
        getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[name="title"]']) ||
        doc.querySelector('title')?.textContent.trim() ||
        this.getDomain(url),

      // Description
      description: getMeta([
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[name="description"]',
      ]),

      // Image
      image: getMeta([
        'meta[property="og:image"]',
        'meta[property="og:image:url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
      ]),

      // Favicon
      favicon:
        getLink(['link[rel="icon"]', 'link[rel="shortcut icon"]', 'link[rel="apple-touch-icon"]']) ||
        `https://www.google.com/s2/favicons?domain=${this.getDomain(url)}`,

      // Additional metadata
      siteName: getMeta(['meta[property="og:site_name"]', 'meta[name="application-name"]']),

      author: getMeta(['meta[name="author"]', 'meta[property="article:author"]']),

      publishedTime: getMeta(['meta[property="article:published_time"]', 'meta[name="publish_date"]']),

      modifiedTime: getMeta(['meta[property="article:modified_time"]', 'meta[name="last-modified"]']),
    };
  }

  /**
   * Validate and normalize URL
   */
  static normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.href;
    } catch {
      // Try adding https://
      return this.normalizeUrl(`https://${url}`);
    }
  }

  /**
   * Resolve relative URLs
   */
  static resolveUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }

  /**
   * Extract domain from URL
   */
  static getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Check if URL is valid
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
```

```typescript
// packages/link-scraper/src/core/cache.ts
export interface CacheStore {
  get(key: string): Promise<LinkMetadata | null>;
  set(key: string, value: LinkMetadata, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCache implements CacheStore {
  private cache = new Map<string, { data: LinkMetadata; expires: number }>();

  async get(key: string): Promise<LinkMetadata | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  async set(key: string, value: LinkMetadata, ttl = 3600000): Promise<void> {
    this.cache.set(key, {
      data: value,
      expires: Date.now() + ttl,
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}
```

### 2. Electron Implementation (in main app)

```typescript
// apps/electron/main/scraper/index.ts
import { ipcMain } from 'electron';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { MetadataExtractor, LinkMetadata, MemoryCache } from '@we/link-scraper/core';

class ElectronLinkScraper {
  private cache = new MemoryCache();

  async scrape(url: string): Promise<LinkMetadata> {
    // Normalize URL
    const normalizedUrl = MetadataExtractor.normalizeUrl(url);

    // Check cache
    const cached = await this.cache.get(normalizedUrl);
    if (cached) return cached;

    try {
      // Fetch HTML (Electron-specific: Node.js fetch)
      const response = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WEBot/1.0)',
        },
        timeout: 5000,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Adapt cheerio to MetadataExtractor interface
      const doc = {
        querySelector: (selector: string) => {
          const el = $(selector).first();
          if (!el.length) return null;
          return {
            getAttribute: (name: string) => el.attr(name) || null,
            textContent: el.text(),
          };
        },
        querySelectorAll: (selector: string) => {
          return $(selector)
            .toArray()
            .map((el) => ({
              getAttribute: (name: string) => $(el).attr(name) || null,
              textContent: $(el).text(),
            }));
        },
        textContent: $.text(),
      };

      // Use shared parsing logic
      const metadata = MetadataExtractor.extract(doc, normalizedUrl);

      // Cache result
      await this.cache.set(normalizedUrl, metadata);

      return metadata;
    } catch (error) {
      // Fallback to basic metadata
      return {
        url: normalizedUrl,
        title: MetadataExtractor.getDomain(normalizedUrl),
        description: undefined,
        image: undefined,
        favicon: `https://www.google.com/s2/favicons?domain=${MetadataExtractor.getDomain(normalizedUrl)}`,
      };
    }
  }
}

// Register IPC handler
const scraper = new ElectronLinkScraper();

ipcMain.handle('scrape-link', async (event, url: string) => {
  return await scraper.scrape(url);
});
```

```typescript
// apps/electron/preload/scraper.ts
import { ipcRenderer } from 'electron';
import type { LinkMetadata } from '@we/link-scraper/core';

export async function scrapeLink(url: string): Promise<LinkMetadata> {
  return await ipcRenderer.invoke('scrape-link', url);
}
```

### 3. Tauri Implementation (in main app)

```rust
// apps/tauri/src-tauri/src/scraper.rs
use tauri::command;
use reqwest;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LinkMetadata {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub favicon: Option<String>,
    pub site_name: Option<String>,
    pub author: Option<String>,
    pub published_time: Option<String>,
    pub modified_time: Option<String>,
}

#[command]
pub async fn scrape_link(url: String) -> Result<LinkMetadata, String> {
    // Fetch HTML
    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?;

    let html = response.text()
        .await
        .map_err(|e| e.to_string())?;

    // Parse HTML
    let document = Html::parse_document(&html);

    // Extract metadata (Rust version of MetadataExtractor logic)
    Ok(extract_metadata(&document, &url))
}

fn extract_metadata(document: &Html, url: &str) -> LinkMetadata {
    let get_meta = |properties: &[&str]| -> Option<String> {
        for property in properties {
            // Try property attribute
            if let Some(content) = select_attr(document, &format!("meta[property='{}']", property), "content") {
                return Some(content);
            }
            // Try name attribute
            if let Some(content) = select_attr(document, &format!("meta[name='{}']", property), "content") {
                return Some(content);
            }
        }
        None
    };

    LinkMetadata {
        url: url.to_string(),
        title: get_meta(&["og:title", "twitter:title", "title"])
            .or_else(|| select_text(document, "title"))
            .or_else(|| Some(get_domain(url))),
        description: get_meta(&["og:description", "twitter:description", "description"]),
        image: get_meta(&["og:image", "twitter:image"]),
        favicon: get_meta(&["icon", "shortcut icon"])
            .or_else(|| Some(format!("https://www.google.com/s2/favicons?domain={}", get_domain(url)))),
        site_name: get_meta(&["og:site_name", "application-name"]),
        author: get_meta(&["author", "article:author"]),
        published_time: get_meta(&["article:published_time", "publish_date"]),
        modified_time: get_meta(&["article:modified_time", "last-modified"]),
    }
}

fn select_attr(document: &Html, selector_str: &str, attr: &str) -> Option<String> {
    let selector = Selector::parse(selector_str).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|el| el.value().attr(attr))
        .map(String::from)
}

fn select_text(document: &Html, selector_str: &str) -> Option<String> {
    let selector = Selector::parse(selector_str).ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>())
}

fn get_domain(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(String::from))
        .unwrap_or_else(|| url.to_string())
}
```

```typescript
// apps/tauri/src/lib/scraper.ts
import { invoke } from '@tauri-apps/api/tauri';
import type { LinkMetadata } from '@we/link-scraper/core';

export async function scrapeLink(url: string): Promise<LinkMetadata> {
  return await invoke('scrape_link', { url });
}
```

### 4. Shared Frontend Usage

```typescript
// packages/block-composer/solid/src/plugins/LinkCardPlugin.ts
import { useLexicalComposerContext } from 'lexical-solid';
import { $createLinkCardNode } from '../nodes/LinkCardNode';
import type { LinkMetadata } from '@we/link-scraper/core';

// Platform-agnostic scraper import (provided by app)
interface ScraperService {
  scrapeLink(url: string): Promise<LinkMetadata>;
}

export function LinkCardPlugin(props: { scraper: ScraperService }) {
  const [editor] = useLexicalComposerContext();

  const handlePasteUrl = async (url: string) => {
    // Show loading state
    editor.update(() => {
      const loading = $createParagraphNode();
      loading.append($createTextNode('Loading link preview...'));
      $insertNodes([loading]);
    });

    try {
      // Scrape using platform-specific implementation
      const metadata = await props.scraper.scrapeLink(url);

      // Replace with link card
      editor.update(() => {
        const linkCard = $createLinkCardNode(metadata);
        $insertNodes([linkCard]);
      });
    } catch (error) {
      console.error('Failed to scrape link:', error);
      // Fallback to plain link
    }
  };

  return null;
}
```

## What Goes Where? 📦

### `@we/link-scraper` package:

- ✅ `MetadataExtractor` (pure parsing logic)
- ✅ Type definitions (`LinkMetadata`, etc.)
- ✅ URL utilities (normalize, validate, resolve)
- ✅ Cache interfaces
- ✅ Tests for parsing logic
- ❌ **NO** platform-specific HTTP clients
- ❌ **NO** platform-specific DOM adapters

### `apps/electron/` (Electron-specific):

- ✅ IPC handler setup
- ✅ `node-fetch` / `axios` usage
- ✅ `cheerio` adapter
- ✅ Electron cache implementation

### `apps/tauri/` (Tauri-specific):

- ✅ Tauri command definitions
- ✅ `reqwest` HTTP client
- ✅ `scraper` crate usage
- ✅ Rust-side caching (sled/etc)

## Package.json Setup

```json
// packages/link-scraper/package.json
{
  "name": "@we/link-scraper",
  "version": "0.1.0",
  "main": "./dist/core/index.js",
  "types": "./dist/core/index.d.ts",
  "exports": {
    "./core": {
      "import": "./dist/core/index.js",
      "types": "./dist/core/index.d.ts"
    },
    "./electron": {
      "import": "./dist/electron/index.js",
      "types": "./dist/electron/index.d.ts"
    }
  },
  "dependencies": {},
  "peerDependencies": {
    // No platform-specific deps
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

```json
// apps/electron/package.json
{
  "dependencies": {
    "@we/link-scraper": "workspace:*",
    "cheerio": "^1.0.0-rc.12",
    "node-fetch": "^3.3.2"
  }
}
```

```toml
# apps/tauri/src-tauri/Cargo.toml
[dependencies]
reqwest = { version = "0.11", features = ["json"] }
scraper = "0.17"
url = "2.4"
```

## Benefits of This Approach 🎯

1. **Shared Logic**: Parsing rules, URL handling, types all in one place
2. **Platform-Optimized**: Each platform uses native HTTP (Node vs Rust)
3. **Testable**: Core logic can be unit tested independently
4. **Maintainable**: Bug fixes to parsing logic benefit both platforms
5. **Flexible**: Easy to add browser extension or web worker versions later
6. **Type Safe**: TypeScript types flow from core to both platforms

## Summary

Create `@we/link-scraper` with platform-agnostic parsing logic and types. Keep platform-specific HTTP/DOM code in each app (`apps/electron`, `apps/tauri`). The shared package is ~90% of the code (all the parsing), each app has ~10% (fetching + adapters). This maximizes code reuse while respecting platform differences.
