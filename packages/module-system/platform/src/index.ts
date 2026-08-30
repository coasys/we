/**
 * Platform feature module — hosted Coasys auth, billing, usage, and session management.
 *
 * Follows the same pattern as @we/module-notes: schema fragments stay as SchemaNode objects,
 * the store uses injected reactivity via `deps.signal`, and the module imports no framework.
 *
 * The platform module provides:
 *   - Auth stores (login, signup, guest entry, two-JWT session management)
 *   - Billing stores (tier, credits, Stripe checkout redirect)
 *   - Usage stores (credit breakdown, per-space, time-range)
 *   - Guest flow (banner chrome, conversion form)
 *   - Schema fragments for all platform views
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';

import { type AuthResult, PlatformApi, type PlatformConfig } from './api';

export { PlatformApi };
export type { AuthResult, PlatformConfig };
export type { BillingInfo, UsageResponse, SpaceInfo, ApiError } from './api';

// ─── Schema fragments ───────────────────────────────────────────────────────

/** Login form — email + password + toggle to signup + self-host link. */
const loginForm: SchemaNode = {
  type: 'Column',
  props: { gap: '400', align: 'center', p: '600', maxWidth: '400px', margin: '0 auto' },
  $localState: {
    email: { type: 'string', initial: '' },
    password: { type: 'string', initial: '' },
    error: { type: 'string', initial: '' },
    loading: { type: 'boolean', initial: false },
  },
  children: [
    { type: 'we-text', props: { variant: 'heading-lg' }, children: ['Sign in'] },
    {
      type: 'we-input',
      props: {
        type: 'email',
        placeholder: 'Email',
        value: { $local: 'email' },
        onInput: { $setLocal: 'email', from: '$event.target.value' },
      },
    },
    {
      type: 'we-input',
      props: {
        type: 'password',
        placeholder: 'Password',
        value: { $local: 'password' },
        onInput: { $setLocal: 'password', from: '$event.target.value' },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $local: 'error' },
        then: {
          type: 'we-text',
          props: { variant: 'body-sm', color: 'error' },
          children: [{ $local: 'error' }],
        },
      },
    },
    {
      type: 'we-button',
      props: {
        onClick: {
          $action: 'modules.platform.login',
          args: [{ $local: 'email' }, { $local: 'password' }],
        },
        disabled: { $local: 'loading' },
      },
      children: ['Sign in'],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.platform.showSignup' } },
      children: ['Create an account'],
    },
    {
      type: 'we-text',
      props: { variant: 'body-xs', color: 'muted' },
      children: [
        'Prefer to self-host? ',
        { type: 'we-link', props: { href: 'https://docs.coasys.org/self-host' }, children: ['Learn more'] },
      ],
    },
  ],
};

/** Signup form — email + password + invite code. */
const signupForm: SchemaNode = {
  type: 'Column',
  props: { gap: '400', align: 'center', p: '600', maxWidth: '400px', margin: '0 auto' },
  $localState: {
    email: { type: 'string', initial: '' },
    password: { type: 'string', initial: '' },
    inviteCode: { type: 'string', initial: '' },
    error: { type: 'string', initial: '' },
    loading: { type: 'boolean', initial: false },
  },
  children: [
    { type: 'we-text', props: { variant: 'heading-lg' }, children: ['Create account'] },
    {
      type: 'we-input',
      props: {
        type: 'email',
        placeholder: 'Email',
        value: { $local: 'email' },
        onInput: { $setLocal: 'email', from: '$event.target.value' },
      },
    },
    {
      type: 'we-input',
      props: {
        type: 'password',
        placeholder: 'Password',
        value: { $local: 'password' },
        onInput: { $setLocal: 'password', from: '$event.target.value' },
      },
    },
    {
      type: 'we-input',
      props: {
        placeholder: 'Invite code',
        value: { $local: 'inviteCode' },
        onInput: { $setLocal: 'inviteCode', from: '$event.target.value' },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $local: 'error' },
        then: {
          type: 'we-text',
          props: { variant: 'body-sm', color: 'error' },
          children: [{ $local: 'error' }],
        },
      },
    },
    {
      type: 'we-button',
      props: {
        onClick: {
          $action: 'modules.platform.signup',
          args: [{ $local: 'email' }, { $local: 'password' }, { $local: 'inviteCode' }],
        },
        disabled: { $local: 'loading' },
      },
      children: ['Create account'],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.platform.showLogin' } },
      children: ['Already have an account?'],
    },
  ],
};

/** Guest banner — persistent chrome, shown when browsing as a guest. */
const guestBanner: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.platform.isGuest' },
    then: {
      type: 'Row',
      props: { bg: 'accent-subtle', p: '300', gap: '300', align: 'center', justify: 'center' },
      children: [
        { type: 'we-text', props: { variant: 'body-sm' }, children: ["You're browsing as a guest."] },
        {
          type: 'we-button',
          props: { size: 'xs', onClick: { $action: 'modules.platform.showGuestConvert' } },
          children: ['Sign up to keep your data'],
        },
      ],
    },
  },
};

/** Guest conversion form — email + password + invite code. */
const guestConvertForm: SchemaNode = {
  type: 'Column',
  props: { gap: '400', p: '600', maxWidth: '400px', margin: '0 auto' },
  $localState: {
    email: { type: 'string', initial: '' },
    password: { type: 'string', initial: '' },
    inviteCode: { type: 'string', initial: '' },
    error: { type: 'string', initial: '' },
  },
  children: [
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Keep your data'] },
    {
      type: 'we-text',
      props: { variant: 'body-sm', color: 'muted' },
      children: ['Create an account to save everything from this session.'],
    },
    {
      type: 'we-input',
      props: {
        type: 'email',
        placeholder: 'Email',
        value: { $local: 'email' },
        onInput: { $setLocal: 'email', from: '$event.target.value' },
      },
    },
    {
      type: 'we-input',
      props: {
        type: 'password',
        placeholder: 'Password',
        value: { $local: 'password' },
        onInput: { $setLocal: 'password', from: '$event.target.value' },
      },
    },
    {
      type: 'we-input',
      props: {
        placeholder: 'Invite code',
        value: { $local: 'inviteCode' },
        onInput: { $setLocal: 'inviteCode', from: '$event.target.value' },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $local: 'error' },
        then: {
          type: 'we-text',
          props: { variant: 'body-sm', color: 'error' },
          children: [{ $local: 'error' }],
        },
      },
    },
    {
      type: 'we-button',
      props: {
        onClick: {
          $action: 'modules.platform.convertGuest',
          args: [{ $local: 'email' }, { $local: 'password' }, { $local: 'inviteCode' }],
        },
      },
      children: ['Create account'],
    },
  ],
};

/** Billing panel — current plan, credits, upgrade/top-up buttons, portal link. */
const billingPanel: SchemaNode = {
  type: 'Column',
  props: { gap: '500', p: '600' },
  children: [
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Billing'] },
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { justify: 'space-between', align: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'body-sm', color: 'muted' }, children: ['Current plan'] },
            { type: 'we-text', props: { variant: 'body-md' }, children: [{ $store: 'modules.platform.tier' }] },
          ],
        },
        {
          type: 'Row',
          props: { justify: 'space-between', align: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'body-sm', color: 'muted' }, children: ['Credits'] },
            {
              type: 'we-text',
              props: { variant: 'body-md' },
              children: [{ $store: 'modules.platform.creditDisplay' }],
            },
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '300' },
      children: [
        {
          type: 'we-button',
          props: { size: 'sm', onClick: { $action: 'modules.platform.upgrade' } },
          children: ['Upgrade plan'],
        },
        {
          type: 'we-button',
          props: { variant: 'outline', size: 'sm', onClick: { $action: 'modules.platform.topUpCredits' } },
          children: ['Buy credits'],
        },
      ],
    },
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.platform.openBillingPortal' } },
      children: ['Manage billing →'],
    },
  ],
};

/** Usage panel — total credits used, time-range selector. */
const usagePanel: SchemaNode = {
  type: 'Column',
  props: { gap: '500', p: '600' },
  children: [
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Usage'] },
    {
      type: 'Row',
      props: { gap: '200' },
      children: [
        {
          type: 'we-button',
          props: { size: 'xs', variant: 'ghost', onClick: { $action: 'modules.platform.loadUsage', args: [7] } },
          children: ['7d'],
        },
        {
          type: 'we-button',
          props: { size: 'xs', variant: 'ghost', onClick: { $action: 'modules.platform.loadUsage', args: [30] } },
          children: ['30d'],
        },
        {
          type: 'we-button',
          props: { size: 'xs', variant: 'ghost', onClick: { $action: 'modules.platform.loadUsage', args: [90] } },
          children: ['90d'],
        },
      ],
    },
    {
      type: 'Row',
      props: { justify: 'space-between', align: 'center' },
      children: [
        { type: 'we-text', props: { variant: 'body-sm', color: 'muted' }, children: ['Total credits used'] },
        {
          type: 'we-text',
          props: { variant: 'body-md' },
          children: [{ $store: 'modules.platform.usageTotalDisplay' }],
        },
      ],
    },
  ],
};

/** 402 upgrade modal — shown when an API call returns insufficient credits. */
const upgradeModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.platform.showUpgradeModal' },
    then: {
      type: 'Column',
      props: { position: 'fixed', inset: '0', bg: 'overlay', zIndex: '1000', align: 'center', justify: 'center' },
      children: [
        {
          type: 'Column',
          props: { bg: 'surface', r: '400', p: '600', gap: '400', maxWidth: '480px', width: '100%' },
          children: [
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Credits exhausted'] },
            {
              type: 'we-text',
              props: { variant: 'body-sm', color: 'muted' },
              children: ['Upgrade your plan or buy credits to continue using AI features.'],
            },
            {
              type: 'Row',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-button',
                  props: { onClick: { $action: 'modules.platform.upgrade' } },
                  children: ['Upgrade plan'],
                },
                {
                  type: 'we-button',
                  props: { variant: 'outline', onClick: { $action: 'modules.platform.topUpCredits' } },
                  children: ['Buy credits'],
                },
              ],
            },
            {
              type: 'we-text',
              props: { variant: 'body-xs', color: 'muted' },
              children: [
                'Prefer to self-host? ',
                { type: 'we-link', props: { href: 'https://docs.coasys.org/self-host' }, children: ['Learn how'] },
              ],
            },
            {
              type: 'we-button',
              props: { variant: 'ghost', size: 'xs', onClick: { $action: 'modules.platform.dismissUpgradeModal' } },
              children: ['Dismiss'],
            },
          ],
        },
      ],
    },
  },
};

/** Account settings — email display, delete with confirmation. */
const accountPanel: SchemaNode = {
  type: 'Column',
  props: { gap: '500', p: '600' },
  $localState: { confirmDelete: { type: 'boolean', initial: false } },
  children: [
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Account'] },
    {
      type: 'Row',
      props: { justify: 'space-between', align: 'center' },
      children: [
        { type: 'we-text', props: { variant: 'body-sm', color: 'muted' }, children: ['Email'] },
        { type: 'we-text', props: { variant: 'body-md' }, children: [{ $store: 'modules.platform.email' }] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $not: { $local: 'confirmDelete' } },
        then: {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', color: 'error', onClick: { $setLocal: 'confirmDelete', value: true } },
          children: ['Delete account'],
        },
        else: {
          type: 'Column',
          props: { gap: '300', bg: 'error-subtle', p: '400', r: '300' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'body-sm' },
              children: ['This will permanently delete your account, cancel any subscriptions, and remove all data.'],
            },
            {
              type: 'Row',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.platform.deleteAccount' } },
                  children: ['Confirm delete'],
                },
                {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'sm', onClick: { $setLocal: 'confirmDelete', value: false } },
                  children: ['Cancel'],
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

// ─── Module definition ──────────────────────────────────────────────────────

export const platformModule = defineModule({
  id: 'platform',
  name: 'Platform',
  description: 'Hosted Coasys platform — authentication, billing, usage tracking, and session management.',
  icon: 'shield',

  capabilities: ['storage', 'network:*'],

  schemas: {
    loginForm,
    signupForm,
    guestBanner,
    guestConvertForm,
    billingPanel,
    usagePanel,
    upgradeModal,
    accountPanel,
  },

  /** Guest banner as persistent chrome — visible across navigation. */
  slots: [{ anchor: 'banner', node: guestBanner }],

  createStore: ({ signal }: ModuleStoreDeps) => {
    // ── Auth state ──
    const [authView, setAuthView] = signal<'login' | 'signup' | 'guest-convert'>('login');
    const [token, setToken] = signal<string | null>(null);
    const [refreshTokenVal, setRefreshToken] = signal<string | null>(null);
    const [email, setEmail] = signal('');
    const [tier, setTier] = signal('free');
    const [accountId, setAccountId] = signal('');
    const [isGuest, setIsGuest] = signal(false);
    const [executorUrl, setExecutorUrl] = signal('');
    const [ad4mEmail, setAd4mEmail] = signal('');
    const [ad4mPassword, setAd4mPassword] = signal('');

    // ── Billing state ──
    const [creditBalanceCents, setCreditBalanceCents] = signal(0);
    const [showUpgradeModal, setShowUpgradeModal] = signal(false);

    // ── Usage state ──
    const [usageTotal, setUsageTotal] = signal(0);
    const [usageSpaces, setUsageSpaces] = signal<unknown[]>([]);

    // ── Config ──
    const [config, setConfig] = signal<PlatformConfig | null>(null);

    // ── API ──
    // Base URL configured via the global set by the connector, or falls back to the page origin
    // (Worker and Pages share the same domain in production).
    const apiBaseUrl =
      typeof globalThis.window !== 'undefined'
        ? (((globalThis as Record<string, unknown>).__PLATFORM_API_URL__ as string | undefined) ??
          globalThis.window.location.origin)
        : '';
    const api = new PlatformApi(apiBaseUrl);

    /** Persist auth result from login/signup/guest. */
    function storeAuth(result: AuthResult) {
      setToken(result.token);
      setRefreshToken(result.refreshToken);
      setEmail(result.account.email);
      setTier(result.account.tier);
      setAccountId(result.account.id);
      setExecutorUrl(result.executor.url);
      setAd4mEmail(result.ad4m.email);
      setAd4mPassword(result.ad4m.password);
    }

    return {
      // ── Exposed state (read by schemas via $store) ──
      authView,
      token,
      email,
      tier,
      accountId,
      isGuest,
      executorUrl,
      ad4mEmail,
      ad4mPassword,
      config,
      creditBalanceCents,
      showUpgradeModal,
      usageTotal,
      usageSpaces,

      /** Formatted credit balance for display. */
      creditDisplay: () => `$${(creditBalanceCents() / 100).toFixed(2)}`,
      /** Formatted usage total for display. */
      usageTotalDisplay: () => `$${(usageTotal() / 100).toFixed(2)}`,

      // ── Auth actions ──
      showLogin: () => setAuthView('login'),
      showSignup: () => setAuthView('signup'),
      showGuestConvert: () => setAuthView('guest-convert'),

      login: async (loginEmail: string, password: string) => {
        const result = await api.login(loginEmail, password);
        storeAuth(result);
        setIsGuest(false);
      },

      signup: async (signupEmail: string, password: string, inviteCode: string) => {
        const result = await api.signup(signupEmail, password, inviteCode);
        storeAuth(result);
        setIsGuest(false);
      },

      guestEntry: async (spaceId: string) => {
        const result = await api.guestEntry(spaceId);
        storeAuth(result);
        setIsGuest(true);
      },

      convertGuest: async (convertEmail: string, password: string, inviteCode: string) => {
        const tok = token();
        if (!tok) return;
        const result = await api.guestConvert(tok, convertEmail, password, inviteCode);
        storeAuth(result);
        setIsGuest(false);
      },

      logout: () => {
        setToken(null);
        setRefreshToken(null);
        setEmail('');
        setTier('free');
        setAccountId('');
        setIsGuest(false);
        setExecutorUrl('');
        setAd4mEmail('');
        setAd4mPassword('');
      },

      refreshSession: async () => {
        const rt = refreshTokenVal();
        if (!rt) return;
        try {
          const result = await api.refresh(rt);
          setToken(result.token);
        } catch {
          setToken(null);
          setRefreshToken(null);
        }
      },

      // ── Config ──
      loadConfig: async () => {
        const cfg = await api.getConfig();
        setConfig(cfg);
      },

      // ── Billing actions ──
      loadBilling: async () => {
        const tok = token();
        if (!tok) return;
        const info = await api.getBilling(tok);
        setTier(info.tier);
        setCreditBalanceCents(info.creditBalanceCents);
      },

      upgrade: async () => {
        const tok = token();
        if (!tok) return;
        const session = await api.createCheckoutSession(tok, 'subscription');
        globalThis.window?.open(session.url, '_self');
      },

      topUpCredits: async () => {
        const tok = token();
        if (!tok) return;
        const session = await api.createCheckoutSession(tok, 'credits');
        globalThis.window?.open(session.url, '_self');
      },

      openBillingPortal: async () => {
        const tok = token();
        if (!tok) return;
        const portal = await api.getPortalUrl(tok);
        globalThis.window?.open(portal.url, '_self');
      },

      dismissUpgradeModal: () => setShowUpgradeModal(false),
      triggerUpgradeModal: () => setShowUpgradeModal(true),

      // ── Usage actions ──
      loadUsage: async (days: number) => {
        const tok = token();
        if (!tok) return;
        const usage = await api.getUsage(tok, days);
        setUsageTotal(usage.totalCreditsUsed);
        setUsageSpaces(usage.spaces);
      },

      // ── Account actions ──
      deleteAccount: async () => {
        const tok = token();
        if (!tok) return;
        await api.deleteAccount(tok);
        globalThis.window?.location.assign('/goodbye');
      },

      // ── Internals (used by the connector, not by schemas) ──
      api,
      storeAuth,
    };
  },
});
