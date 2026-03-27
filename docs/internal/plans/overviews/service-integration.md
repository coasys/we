# Plan: Service Integration — AD4M Services, Built-in Service Stores & Community Services

> How WE exposes AD4M's backend services (payments, AI, WebRTC, etc.) to schema-rendered apps, and how community-developed services can be shared via the marketplace.

---

## The Problem

WE's schema system handles data well (`$query` for CRUD, `$store` for UI state), but some functionality isn't "data you query" — it's **ongoing processes with lifecycle, streams, and side effects**:

- Sending/receiving payments (HoloFuel / Unyt)
- Establishing WebRTC calls (signalling, media streams, peer state)
- Streaming AI inference (token-by-token LLM output, live transcription)
- Presence and typing indicators
- File uploads with progress

These are **services** — they connect, produce ephemeral streams, require authorization, and eventually disconnect. They don't fit `$query` (not persistent data) and they're not simple UI state (`$localState`). They need their own integration pattern.

---

## Core Insight: Services Are Stores

WE already has a clean pattern for framework-provided state: **built-in stores** consumed via `$store` / `$action`. RouteStore, ThemeStore, ModalStore, AdamStore — all follow the same shape:

1. SolidJS context provider wraps the app
2. Store exposes reactive signals (read) and methods (write)
3. Schemas access them via `$store: "storeName.property"` and `$action: "storeName.method"`

Services fit this pattern exactly. A payment service has readable state (balance, pending transactions) and callable methods (request payment, accept proposal). A WebRTC service has readable state (participants, connection status) and callable methods (join call, toggle mute). The schema doesn't need to know these are backed by AD4M GraphQL calls rather than local signals — the `$store` / `$action` interface is the same.

**The rule:** if it has reactive state and methods, it's a store. Whether the backing implementation is `createSignal()`, an AD4M GraphQL subscription, or a WebRTC peer connection is an implementation detail invisible to schemas.

---

## Architecture: Service Store Layer

```
┌─────────────────────────────────────────────────────┐
│  Schema JSON                                        │
│  $store: "paymentService.balance"                   │
│  $action: "paymentService.requestPayment"           │
└──────────────┬──────────────────────────────────────┘
               │ (same $store/$action resolution)
┌──────────────▼──────────────────────────────────────┐
│  Service Store (SolidJS signals + methods)          │
│  - Wraps AD4M GraphQL calls in reactive signals     │
│  - Manages lifecycle (connect/disconnect/reconnect) │
│  - Enforces capability checks                       │
└──────────────┬──────────────────────────────────────┘
               │ (GraphQL queries, mutations, subscriptions)
┌──────────────▼──────────────────────────────────────┐
│  AD4M Runtime Services                              │
│  - UnytService (HoloFuel / payments)                │
│  - AIService (inference, embeddings, transcription) │
│  - HolochainService (P2P, signalling)               │
│  - TelepresenceAdapter (WebRTC)                     │
└─────────────────────────────────────────────────────┘
```

Service stores are **thin reactive wrappers** around AD4M's existing service layer. They don't reimplement service logic — they bridge it to Solid's reactivity system so schemas can bind to it declaratively.

---

## Example 1: Payment Service (HoloFuel / Unyt)

### What AD4M provides

AD4M's `UnytService` (backed by a Holochain alliance DNA) handles distributed payments:

- `runtimeRequestPayment(counterparty, amount)` → creates a payment proposal
- `runtimeAcceptPayment(proposalId)` → commits the transaction
- Balance tracking per user via Holochain DHT
- GraphQL subscriptions for balance changes and hosting events

### The service store

```typescript
// PaymentServiceStore — built-in, ships with WE
function createPaymentServiceStore(client: Ad4mClient) {
  const [balance, setBalance] = createSignal<number | null>(null);
  const [pendingProposals, setPendingProposals] = createSignal<Proposal[]>([]);
  const [lastError, setLastError] = createSignal<string | null>(null);

  // Subscribe to balance changes via AD4M GraphQL subscription
  client.runtime.addHostingUserInfoChangedListener((info) => {
    setBalance(info.creditBalance);
  });

  // Load initial state
  client.runtime.getHostingUserInfo().then((info) => {
    setBalance(info?.creditBalance ?? 0);
  });

  return {
    // Reactive read (consumed via $store)
    balance,
    pendingProposals,
    lastError,
    hasSufficientFunds: () => (balance() ?? 0) > 0,

    // Methods (consumed via $action)
    async requestPayment(recipientDid: string, amount: number, currency = 'HOT') {
      try {
        setLastError(null);
        await client.runtime.requestPayment({ counterparty: recipientDid, amount: { [currency]: String(amount) } });
      } catch (e) {
        setLastError(e instanceof Error ? e.message : 'Payment failed');
        throw e;
      }
    },

    async acceptProposal(proposalId: string) {
      await client.runtime.acceptPayment(proposalId);
    },
  };
}
```

### Schema usage

A "tip creator" button in any app:

```json
{
  "type": "Button",
  "props": {
    "label": { "$concat": ["Tip (Balance: ", { "$store": "paymentService.balance" }, ")"] },
    "onClick": {
      "$action": "paymentService.requestPayment",
      "args": ["$store.spaceStore.creatorDid", 10]
    },
    "disabled": { "$not": { "$store": "paymentService.hasSufficientFunds" } }
  }
}
```

A transaction history panel:

```json
{
  "type": "$forEach",
  "items": { "$store": "paymentService.pendingProposals" },
  "template": {
    "type": "Row",
    "props": {},
    "children": [
      { "type": "Text", "props": { "content": { "$pick": { "from": "$item", "path": "counterparty" } } } },
      { "type": "Text", "props": { "content": { "$pick": { "from": "$item", "path": "amount" } } } },
      {
        "type": "Button",
        "props": {
          "label": "Accept",
          "onClick": {
            "$action": "paymentService.acceptProposal",
            "args": [{ "$pick": { "from": "$item", "path": "id" } }]
          }
        }
      }
    ]
  }
}
```

The app builder doesn't need to know about Holochain, alliance DNAs, or GraphQL subscriptions. They bind to `paymentService` like any other store.

---

## Example 2: WebRTC Signalling / Calls

### What AD4M provides

AD4M's `TelepresenceAdapter` (a language interface) provides WebRTC signalling:

- `setOnlineStatus(status)` — broadcast presence
- `getOnlinePeers()` — discover who's available
- `sendSignal(remoteDid, signal)` / `handleSignal(callback)` — exchange WebRTC SDP offers/answers/ICE candidates

The actual peer connection (`RTCPeerConnection`) runs in the browser. AD4M handles the signalling channel (finding peers, exchanging offers via the neighbourhood's link language).

### The service store

```typescript
// CallServiceStore — built-in, ships with WE
function createCallServiceStore(client: Ad4mClient, perspectiveId: string) {
  const [callState, setCallState] = createSignal<'idle' | 'ringing' | 'connected' | 'ended'>('idle');
  const [participants, setParticipants] = createSignal<Participant[]>([]);
  const [localStream, setLocalStream] = createSignal<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = createSignal<Record<string, MediaStream>>({});
  const [isMuted, setIsMuted] = createSignal(false);
  const [isVideoOff, setIsVideoOff] = createSignal(false);

  // Internal — peer connections managed here, not exposed to schemas
  const peerConnections = new Map<string, RTCPeerConnection>();

  return {
    // Reactive read
    callState,
    participants,
    localStream,
    remoteStreams,
    isMuted,
    isVideoOff,
    participantCount: () => participants().length,
    isInCall: () => callState() === 'connected',

    // Methods
    async startCall(mediaConstraints?: MediaStreamConstraints) {
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints ?? { audio: true, video: true });
      setLocalStream(stream);
      setCallState('ringing');
      // Exchange SDP via AD4M's TelepresenceAdapter...
    },

    async joinCall(callId: string) {
      /* ... */
    },

    toggleMute() {
      const stream = localStream();
      if (!stream) return;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!isMuted());
    },

    toggleVideo() {
      const stream = localStream();
      if (!stream) return;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOff(!isVideoOff());
    },

    async endCall() {
      localStream()
        ?.getTracks()
        .forEach((t) => t.stop());
      peerConnections.forEach((pc) => pc.close());
      peerConnections.clear();
      setLocalStream(null);
      setRemoteStreams({});
      setParticipants([]);
      setCallState('ended');
    },
  };
}
```

### Schema usage

A call UI in any community space:

```json
{
  "type": "Column",
  "children": [
    {
      "type": "$if",
      "condition": { "$not": { "$store": "callService.isInCall" } },
      "then": {
        "type": "Button",
        "props": {
          "label": "Start Call",
          "onClick": { "$action": "callService.startCall" }
        }
      },
      "else": {
        "type": "Column",
        "props": {},
        "children": [
          {
            "type": "VideoGrid",
            "props": {
              "localStream": { "$store": "callService.localStream" },
              "remoteStreams": { "$store": "callService.remoteStreams" }
            }
          },
          {
            "type": "Row",
            "props": {},
            "children": [
              {
                "type": "IconButton",
                "props": {
                  "icon": {
                    "$if": { "condition": { "$store": "callService.isMuted" }, "then": "mic-off", "else": "mic" }
                  },
                  "onClick": { "$action": "callService.toggleMute" }
                }
              },
              {
                "type": "IconButton",
                "props": {
                  "icon": {
                    "$if": { "condition": { "$store": "callService.isVideoOff" }, "then": "video-off", "else": "video" }
                  },
                  "onClick": { "$action": "callService.toggleVideo" }
                }
              },
              {
                "type": "Button",
                "props": {
                  "label": "End Call",
                  "variant": "danger",
                  "onClick": { "$action": "callService.endCall" }
                }
              }
            ]
          }
        ]
      }
    }
  ]
}
```

Note: `VideoGrid` is a **custom component** (Tier 3 in the ecosystem doc) — it takes `MediaStream` objects and renders `<video>` elements. This is the kind of component that the core library should eventually include, but it's a good example of where a service store exposes non-serializable values (media streams) that only a purpose-built component can consume. Schema JSON can wire them together declaratively even though the underlying values are complex browser objects.

---

## Service Store Registration

Service stores slot into the existing provider hierarchy. They're registered alongside other built-in stores and passed to the schema dispatcher through the same `stores` bag:

```typescript
// In StoreProvider or a dedicated ServiceProvider
const paymentService = createPaymentServiceStore(adamClient);
const callService = createCallServiceStore(adamClient, perspectiveId);
const aiService = createAIServiceStore(adamClient);

// Merged into the stores bag alongside existing stores
const stores = {
  adamStore,
  spaceStore,
  modalStore,
  themeStore,
  routeStore, // existing
  paymentService,
  callService,
  aiService, // service stores
};
```

No changes to the dispatcher, `$store` resolver, or `$action` resolver. Service stores are consumed identically to UI stores — the dispatcher doesn't distinguish between them.

### Lazy instantiation

Not all apps need all services. Service stores should be **lazily created** — instantiated on first `$store` or `$action` reference rather than eagerly on app start. This avoids unnecessary GraphQL subscriptions and permission prompts for apps that don't use payments or calls.

```typescript
const serviceFactories: Record<string, (client: Ad4mClient) => unknown> = {
  paymentService: createPaymentServiceStore,
  callService: createCallServiceStore,
  aiService: createAIServiceStore,
};

const serviceInstances: Record<string, unknown> = {};

function getServiceStore(name: string, client: Ad4mClient): unknown {
  if (!serviceInstances[name] && serviceFactories[name]) {
    serviceInstances[name] = serviceFactories[name](client);
  }
  return serviceInstances[name];
}
```

The `stores` bag passed to the dispatcher can use a `Proxy` that intercepts property access and lazily instantiates service stores on first read.

---

## Capability Enforcement for Services

Service stores access privileged AD4M operations. The capability system from Phase 5 of the ecosystem plan applies directly:

### Template-level declarations

Templates declare which services they need:

```json
{
  "meta": {
    "name": "Community Marketplace",
    "schemaVersion": "1.1"
  },
  "dependencies": {
    "blocks": ["ProductBlock", "ReviewBlock"],
    "components": [],
    "stores": [],
    "services": ["paymentService"]
  }
}
```

### Activation-time consent

When a user activates a template that declares service dependencies, WE shows a consent prompt:

```
"Community Marketplace" requires:
  ✦ Payment Service — read balance, send/receive payments
  ✦ Block access — ProductBlock, ReviewBlock

[Allow]  [Cancel]
```

### Runtime enforcement

Service stores check capabilities at method call time. A template that didn't declare `paymentService` in its dependencies gets:

- `$store: "paymentService.balance"` → returns `undefined` (or a sentinel "not authorized" value)
- `$action: "paymentService.requestPayment"` → throws with a clear error

This mirrors the package capability model from the ecosystem doc — same enforcement mechanism, applied to service stores instead of package stores.

### Mapping to AD4M capabilities

WE's service capability declarations map directly to AD4M's existing capability system:

| WE service declaration | AD4M capability                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `"paymentService"`     | `{ can: ["READ", "CREATE"], with: { domain: "runtime.hosting", pointers: ["*"] } }` |
| `"aiService"`          | `{ can: ["PROMPT", "TRANSCRIBE"], with: { domain: "artificial intelligence" } }`    |
| `"callService"`        | `{ can: ["READ", "CREATE"], with: { domain: "neighbourhood", pointers: ["*"] } }`   |

WE doesn't create a parallel authorization layer — it maps its human-readable service names to AD4M's capability checks and delegates enforcement to the runtime.

---

## Community Service Stores: Development, Sharing & Installation

### The gap

The built-in service stores (payment, calls, AI) cover AD4M's core runtime services. But communities will want services that WE's core team hasn't built:

- A **reputation service** that aggregates ratings across spaces
- A **scheduling service** that manages calendar availability and booking
- An **e-commerce service** wrapping a specific payment + inventory flow
- A **notification service** with custom delivery rules
- A **storage quota service** for communities managing shared file storage

These aren't core AD4M runtime features — they're **application-level services** built on top of AD4M's primitives (perspectives, models, links, languages). They need the same store interface so schemas can consume them via `$store` / `$action`.

### Community services = `defineAppStore()` with conventions

The `defineAppStore()` API from the ecosystem doc already supports this. A community service store is just a `defineAppStore()` that follows service conventions:

```typescript
defineAppStore({
  name: 'reputationService',
  dependencies: ['query'],
  create: (deps) => {
    const { query } = deps;

    // Query existing reputation data from AD4M
    const ratings = query.subscribe({ model: 'RatingBlock', order: { createdAt: 'DESC' } });
    const [averageRating, setAverageRating] = createSignal(0);

    // Compute derived state
    createEffect(() => {
      const all = ratings();
      if (all.length === 0) return setAverageRating(0);
      const sum = all.reduce((acc, r) => acc + r.score, 0);
      setAverageRating(sum / all.length);
    });

    return {
      // Reactive read
      ratings,
      averageRating,

      // Methods
      async rate(targetDid: string, score: number, comment: string) {
        await query.create('RatingBlock', { targetDid, score, comment });
      },
    };
  },
});
```

This is a "service" in the same way `paymentService` is — reactive state + methods — but it's built entirely on AD4M data primitives (`$query` internally) rather than wrapping a dedicated AD4M runtime service.

### Marketplace distribution (Tier 4½)

Community service stores ship as **packages** — the same package format from the ecosystem doc's Phase 4. A service package contains:

1. **Block types** the service needs (e.g. `RatingBlock`, `BookingBlock`)
2. **The store definition** via `defineAppStore()`
3. **Optionally, custom components** for service-specific UI (e.g. a star-rating widget)

```typescript
// Package manifest for a reputation service
const manifest: PackageManifest = {
  name: '@we-pkg/reputation',
  version: '1.0.0',
  description: 'Community reputation and rating service',

  blocks: [{ type: 'RatingBlock', model: RatingBlock, editorComponent: RatingEditor }],

  stores: [reputationServiceStore],

  components: {
    StarRating: StarRatingComponent,
  },

  capabilities: ['query:RatingBlock', 'store:reputationService'],
};
```

Installation follows the existing package pipeline:

```
User browses marketplace → finds @we-pkg/reputation
  → sees capability prompt ("query RatingBlock, register reputationService store")
  → consents → package downloaded (ESM bundle, cached in IndexedDB)
  → registerBlock(RatingBlock), registerStore(reputationServiceStore), registerComponent(StarRating)
  → templates can now use $store: "reputationService.averageRating"
```

### The spectrum from built-in to community

| Layer                       | Examples                                     | Backing                                        | Ships with WE? | Installation          |
| --------------------------- | -------------------------------------------- | ---------------------------------------------- | -------------- | --------------------- |
| **Built-in service store**  | `paymentService`, `callService`, `aiService` | AD4M runtime services (GraphQL)                | Yes            | Always available      |
| **Framework store**         | `routeStore`, `themeStore`, `modalStore`     | Local signals                                  | Yes            | Always available      |
| **Community service store** | `reputationService`, `schedulingService`     | AD4M data (`$query` internally) + custom logic | No             | Marketplace package   |
| **App-specific store**      | `audioPlayer`, `dragDropState`               | Local signals                                  | No             | Bundled with template |

All four are consumed identically via `$store` / `$action`. The schema doesn't know or care which layer a store comes from.

### Community services that wrap external APIs

Some community services will need to reach outside AD4M — calling a third-party API, connecting to an external WebSocket, etc. These fall into the same **browser-privilege execution** risk category as custom components (see ecosystem doc's "Accepted risk" section):

- The package declares `capabilities: ["network:api.example.com"]`
- The user sees a consent prompt mentioning external network access
- At runtime, the store can `fetch()` — WE can't sandbox this without iframe isolation

The mitigation is the same: marketplace curation, author DID accountability, and user consent. Most community services should be buildable on AD4M primitives alone (perspectives, models, links). Services needing external network access are the exception and should be clearly labeled.

---

## Implementation Sequence

Service integration doesn't require its own phase — it plugs into existing phases from the ecosystem doc:

### Phase 1 (with `$query`)

- Service stores are just stores — no new dispatcher work needed
- **One built-in service store as proof of concept:** `aiService` is the simplest (wraps `aiPrompt` / `aiEmbed` mutations, `aiTranscriptionText` subscription)
- Validates: lazy instantiation, GraphQL subscription → signal bridging, capability check pattern

### Phase 4 (with `defineAppStore()` + packages)

- Community service stores become possible via `defineAppStore()`
- Service packages ship blocks + store + components together
- Package manifest gains `services` field for clearer marketplace categorization

### Phase 5 (with capability enforcement)

- Template `dependencies.services` declarations enforced at activation time
- Service store access gated by capability proxy
- WE service names mapped to AD4M capability domains

### Phase 6 (with marketplace)

- Community service packages browsable in marketplace
- Service category / tag for discoverability
- Dependency resolution handles service store requirements

---

## Design Decisions & Rationale

### Why stores, not a `$service` token?

A dedicated `$service` token would add a new resolver, Zod schema, tests, AI context, and documentation for semantics that `$store` / `$action` already express. The token governance principle ("3+ templates, can't be expressed with existing tokens") rules it out — `$store` handles it today. If service usage patterns diverge significantly from store patterns in practice (e.g. needing lifecycle hooks like `onConnect` / `onDisconnect` at the schema level), a `$service` token can be extracted later.

### Why lazy instantiation?

Eagerly creating all service stores on app start would:

- Open unnecessary GraphQL subscriptions
- Trigger capability checks / consent prompts for unused services
- Allocate resources (WebRTC, media streams) that may never be needed

Lazy creation on first `$store` / `$action` reference means apps only pay for what they use.

### Why map to AD4M capabilities instead of inventing new ones?

AD4M already has a capability system with domain-based authorization (`agent`, `artificial intelligence`, `runtime.hosting`, `perspective`, `neighbourhood`, `language`) and action-level granularity (`READ`, `CREATE`, `UPDATE`, `DELETE`, `PROMPT`, `TRANSCRIBE`). WE's service names are a human-friendly alias layer — not a replacement.

### Why not make all community services AD4M languages?

AD4M's language system is for **expression storage and retrieval** — it's the wrong abstraction for stateful client-side services with lifecycle. A reputation service needs reactive signals, derived computations, and method calls. An AD4M language provides `get(address)` and `create(content)`. The store interface is a much better fit.

That said, community services often use AD4M data under the hood (querying models, creating links). The `dependencies: ['query']` pattern in `defineAppStore()` enables this cleanly — the service store gets the query service injected and uses it to read/write AD4M data, while exposing a higher-level reactive interface to schemas.

### What about services that need background execution?

Some services need to run when no schema is rendering them — a notification service polling for updates, a sync service running periodic reconciliation. This is **out of scope for service stores**, which are UI-layer constructs tied to component lifecycle.

Background execution is an AD4M runtime concern. If a community needs background processing, it should be implemented as an AD4M language (which runs in the executor) or a Holochain DNA (which runs on the conductor). The WE service store then wraps the results of that background work in reactive signals for UI consumption. This separation keeps the UI layer simple and the background work in the right execution context.
