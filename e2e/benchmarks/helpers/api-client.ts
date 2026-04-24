/**
 * API client abstraction — GraphQL (current) with REST (future) auto-detection.
 * Mirrors ad4m/benchmarks/src/client.ts patterns but adds transport abstraction.
 */

export interface LinkInput {
  source: string;
  predicate: string;
  target: string;
}

export interface LinkExpression {
  author: string;
  timestamp: string;
  data: LinkInput;
  proof?: { valid: boolean; key: string; signature: string };
}

export interface ApiClient {
  readonly transport: 'graphql' | 'rest';

  addPerspective(name: string): Promise<string>;
  removePerspective(uuid: string): Promise<void>;
  addLink(uuid: string, link: LinkInput): Promise<LinkExpression>;
  addLinks(uuid: string, links: LinkInput[]): Promise<void>;
  querySparql(uuid: string, query: string): Promise<any>;
  queryLinks(uuid: string, query: Record<string, string>): Promise<LinkExpression[]>;
  agentStatus(): Promise<{ isInitialized: boolean; isUnlocked: boolean; did: string }>;
  agentGenerate(passphrase: string): Promise<string>;
  agentUnlock(passphrase: string): Promise<string>;
  healthCheck(): Promise<boolean>;
}

// ── GraphQL implementation ──

export class GraphQLApiClient implements ApiClient {
  readonly transport = 'graphql' as const;
  private url: string;
  private adminCredential: string;
  private timeoutMs: number;

  constructor(url: string, adminCredential: string, timeoutMs = 60_000) {
    this.url = url;
    this.adminCredential = adminCredential;
    this.timeoutMs = timeoutMs;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: this.adminCredential,
    };
  }

  private async query<T = unknown>(gql: string, variables?: Record<string, unknown>): Promise<T> {
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ query: gql, variables }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resp.ok) {
      throw new Error(`GraphQL request failed (${resp.status}): ${await resp.text()}`);
    }
    const json = (await resp.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    return json.data as T;
  }

  async addPerspective(name: string): Promise<string> {
    const data = await this.query<{ perspectiveAdd: { uuid: string } }>(
      `mutation($name: String!) { perspectiveAdd(name: $name) { uuid } }`,
      { name },
    );
    return data.perspectiveAdd.uuid;
  }

  async removePerspective(uuid: string): Promise<void> {
    await this.query(`mutation($uuid: String!) { perspectiveRemove(uuid: $uuid) }`, { uuid });
  }

  async addLink(uuid: string, link: LinkInput): Promise<LinkExpression> {
    const data = await this.query<{ perspectiveAddLink: LinkExpression }>(
      `mutation($uuid: String!, $link: LinkInput!) {
        perspectiveAddLink(uuid: $uuid, link: $link) {
          author timestamp data { source predicate target } proof { valid key signature }
        }
      }`,
      { uuid, link },
    );
    return data.perspectiveAddLink;
  }

  async addLinks(uuid: string, links: LinkInput[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < links.length; i += CHUNK) {
      const batch = links.slice(i, i + CHUNK);
      await this.query(
        `mutation($uuid: String!, $links: [LinkInput!]!) {
          perspectiveAddLinks(uuid: $uuid, links: $links) { author }
        }`,
        { uuid, links: batch },
      );
    }
  }

  async querySparql(uuid: string, queryStr: string): Promise<any> {
    const data = await this.query<{ perspectiveQuerySparql: string }>(
      `query($uuid: String!, $query: String!) {
        perspectiveQuerySparql(uuid: $uuid, query: $query)
      }`,
      { uuid, query: queryStr },
    );
    // The GraphQL API returns JSON-stringified results
    const raw = data.perspectiveQuerySparql;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return raw;
    }
  }

  async queryLinks(uuid: string, q: Record<string, string>): Promise<LinkExpression[]> {
    const data = await this.query<{ perspectiveQueryLinks: LinkExpression[] }>(
      `query($uuid: String!, $query: LinkQuery!) {
        perspectiveQueryLinks(uuid: $uuid, query: $query) {
          author timestamp data { source predicate target }
        }
      }`,
      { uuid, query: q },
    );
    return data.perspectiveQueryLinks;
  }

  async agentStatus(): Promise<{ isInitialized: boolean; isUnlocked: boolean; did: string }> {
    const data = await this.query<{
      agentStatus: { isInitialized: boolean; isUnlocked: boolean; did: string };
    }>(`query { agentStatus { isInitialized isUnlocked did } }`);
    return data.agentStatus;
  }

  async agentGenerate(passphrase: string): Promise<string> {
    const data = await this.query<{ agentGenerate: { did: string } }>(
      `mutation($passphrase: String!) { agentGenerate(passphrase: $passphrase) { did } }`,
      { passphrase },
    );
    return data.agentGenerate.did;
  }

  async agentUnlock(passphrase: string): Promise<string> {
    const data = await this.query<{ agentUnlock: { did: string } }>(
      `mutation($passphrase: String!) { agentUnlock(passphrase: $passphrase) { did } }`,
      { passphrase },
    );
    return data.agentUnlock.did;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.agentStatus();
      return true;
    } catch {
      return false;
    }
  }
}

// ── REST implementation (stub — for PR #765 transport comparison) ──

export class RestApiClient implements ApiClient {
  readonly transport = 'rest' as const;
  private baseUrl: string;
  private adminCredential: string;
  private timeoutMs: number;

  constructor(baseUrl: string, adminCredential: string, timeoutMs = 60_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminCredential = adminCredential;
    this.timeoutMs = timeoutMs;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.adminCredential}`,
    };
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resp.ok) {
      throw new Error(`REST ${method} ${path} failed (${resp.status}): ${await resp.text()}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : (undefined as T);
  }

  async addPerspective(name: string): Promise<string> {
    const data = await this.request<{ uuid: string }>('POST', '/api/v1/perspectives', { name });
    return data.uuid;
  }

  async removePerspective(uuid: string): Promise<void> {
    await this.request('DELETE', `/api/v1/perspectives/${encodeURIComponent(uuid)}`);
  }

  async addLink(uuid: string, link: LinkInput): Promise<LinkExpression> {
    return this.request<LinkExpression>(
      'POST',
      `/api/v1/perspectives/${encodeURIComponent(uuid)}/links`,
      link,
    );
  }

  async addLinks(uuid: string, links: LinkInput[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < links.length; i += CHUNK) {
      const batch = links.slice(i, i + CHUNK);
      await this.request(
        'POST',
        `/api/v1/perspectives/${encodeURIComponent(uuid)}/links/bulk`,
        batch,
      );
    }
  }

  async querySparql(uuid: string, queryStr: string): Promise<any> {
    return this.request(
      'POST',
      `/api/v1/perspectives/${encodeURIComponent(uuid)}/query`,
      { engine: 'sparql', query: queryStr },
    );
  }

  async queryLinks(uuid: string, q: Record<string, string>): Promise<LinkExpression[]> {
    const params = new URLSearchParams(q);
    return this.request<LinkExpression[]>(
      'GET',
      `/api/v1/perspectives/${encodeURIComponent(uuid)}/links?${params.toString()}`,
    );
  }

  async agentStatus(): Promise<{ isInitialized: boolean; isUnlocked: boolean; did: string }> {
    return this.request('GET', '/api/v1/agent/status');
  }

  async agentGenerate(passphrase: string): Promise<string> {
    const data = await this.request<{ did: string }>('POST', '/api/v1/agent/generate', {
      passphrase,
    });
    return data.did;
  }

  async agentUnlock(passphrase: string): Promise<string> {
    const data = await this.request<{ did: string }>('POST', '/api/v1/agent/unlock', {
      passphrase,
    });
    return data.did;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }
}

// ── Auto-detection ──

export async function detectTransport(baseUrl: string): Promise<'graphql' | 'rest'> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const text = await resp.text();
      // REST branch returns JSON with version info
      if (text.includes('"version"') || text.includes('"status"')) {
        return 'rest';
      }
    }
  } catch {
    // fall through to graphql
  }
  return 'graphql';
}

export async function createClient(
  baseUrl: string,
  adminCredential: string,
  forceTransport?: 'graphql' | 'rest',
): Promise<ApiClient> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const transport = forceTransport ?? (await detectTransport(cleanBase));
  if (transport === 'rest') {
    return new RestApiClient(cleanBase, adminCredential);
  }
  // Append /graphql if not already present
  const gqlUrl = cleanBase.endsWith('/graphql') ? cleanBase : `${cleanBase}/graphql`;
  return new GraphQLApiClient(gqlUrl, adminCredential);
}
