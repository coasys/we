/**
 * Platform Worker API client.
 *
 * Every call to the Worker attaches the platform JWT from the session store. On 401, the caller
 * retries once after refreshing the token — handled by `platformFetch` in the module store, not
 * here. This class stays stateless: it accepts a token per call rather than holding one.
 */

// ─── Response types ─────────────────────────────────────────────────────────

export interface PlatformConfig {
  executorUrlPattern: string;
  authMode: 'authenticated' | 'guest';
  features: Record<string, boolean>;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  account: { id: string; email: string; tier: string };
  executor: { url: string };
  ad4m: { email: string; password: string };
}

export interface BillingInfo {
  tier: string;
  creditBalanceCents: number;
  stripeCustomerId: string | null;
}

export interface UsageRecord {
  spaceId: string;
  spaceName: string;
  creditsUsed: number;
  breakdown: { type: string; count: number; credits: number }[];
}

export interface UsageResponse {
  totalCreditsUsed: number;
  spaces: UsageRecord[];
  period: { start: string; end: string };
}

export interface SpaceInfo {
  id: string;
  name: string;
  neighbourhoodUrl: string | null;
  createdAt: string;
}

export interface CheckoutSession {
  url: string;
}

// ─── Error with status ──────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Client ─────────────────────────────────────────────────────────────────

export class PlatformApi {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, opts: RequestInit & { token?: string } = {}): Promise<T> {
    const { token, ...fetchOpts } = opts;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${this.baseUrl}${path}`, { ...fetchOpts, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new ApiError(body.error?.message ?? res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  // ── Public endpoints (no token) ──

  async getConfig(): Promise<PlatformConfig> {
    return this.request('/api/config');
  }

  async signup(email: string, password: string, inviteCode: string): Promise<AuthResult> {
    return this.request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, inviteCode }),
    });
  }

  async login(email: string, password: string): Promise<AuthResult> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async refresh(refreshToken: string): Promise<{ token: string }> {
    return this.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  async guestEntry(spaceId: string): Promise<AuthResult> {
    return this.request(`/api/guest/${spaceId}`);
  }

  // ── Authenticated endpoints ──

  async guestConvert(token: string, email: string, password: string, inviteCode: string): Promise<AuthResult> {
    return this.request('/api/guest/convert', {
      method: 'POST',
      token,
      body: JSON.stringify({ email, password, inviteCode }),
    });
  }

  async getBilling(token: string): Promise<BillingInfo> {
    return this.request('/api/billing', { token });
  }

  async createCheckoutSession(
    token: string,
    type: 'subscription' | 'credits',
    priceId?: string,
  ): Promise<CheckoutSession> {
    return this.request('/api/billing/checkout', {
      method: 'POST',
      token,
      body: JSON.stringify({ type, priceId }),
    });
  }

  async getPortalUrl(token: string): Promise<{ url: string }> {
    return this.request('/api/billing/portal', { method: 'POST', token });
  }

  async getUsage(token: string, days: number): Promise<UsageResponse> {
    return this.request(`/api/usage?days=${days}`, { token });
  }

  async getSpaces(token: string): Promise<SpaceInfo[]> {
    return this.request('/api/spaces', { token });
  }

  async createSpace(token: string, name: string): Promise<SpaceInfo> {
    return this.request('/api/spaces', {
      method: 'POST',
      token,
      body: JSON.stringify({ name }),
    });
  }

  async updateSpaceNeighbourhood(token: string, spaceId: string, neighbourhoodUrl: string): Promise<void> {
    await this.request(`/api/spaces/${spaceId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ neighbourhoodUrl }),
    });
  }

  async deleteAccount(token: string): Promise<void> {
    await this.request('/api/account', { method: 'DELETE', token });
  }

  async changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
    await this.request('/api/account/password', {
      method: 'PUT',
      token,
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async changeEmail(token: string, newEmail: string): Promise<void> {
    await this.request('/api/account/email', {
      method: 'PUT',
      token,
      body: JSON.stringify({ email: newEmail }),
    });
  }
}
