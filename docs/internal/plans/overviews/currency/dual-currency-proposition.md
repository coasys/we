# WE Currency Strategy v2

A full synthesis of the dual-currency design for WE/AD4M. For the prior tradeoff analysis see [currency-tradeoff-analysis.md](./currency-tradeoff-analysis.md).

---

## Overview

WE operates a two-layer currency system:

| Layer         | Currency        | Ticker | Issuance trigger                                    | Purpose                                       |
| ------------- | --------------- | ------ | --------------------------------------------------- | --------------------------------------------- |
| Protocol base | **WEAVE**       | WVE    | Verified unique human joins                         | Reserve, staking, governance, fees            |
| Application   | **SynergyFuel** | SYF    | CI contributions: knowledge, synergy, collaboration | Collective intelligence rewards, Synergy Fund |
| Community     | Custom tokens   | —      | Community-defined                                   | Local experimentation                         |

The base layer is intentionally simple and AI-resistant. The application/community layer is where collective intelligence alignment lives, and where experiments can run and fail without corrupting the monetary base. Community currencies are unconstrained.

---

## Part 1 — WEAVE (base currency)

### Philosophy

WEAVE is not a neutral currency with governance layered on top. Its design is intentional: issuance is tied to the growth of verified human participation, economic taxation is baked in at the protocol level, and a universal basic dividend provides genuine structural redistribution. The design aims to avoid concentration dynamics that would eventually capture governance, without encoding a specific theory of collective intelligence value that cannot be unwound.

### Issuance: proof-of-humanity growth

Every agent that verifiably proves their unique humanity receives a fixed welcome mint of WEAVE. Supply therefore grows proportionally to the number of unique human participants. No other issuance trigger exists at the base layer.

**Why this trigger:**

- AI-resistant by construction — you cannot automate being a new human
- Egalitarian — every human receives the same amount regardless of when they join
- Legible — anyone can understand and verify the supply growth model
- Avoids the Goodhart's Law trap of contribution-based issuance

**Proof-of-humanity dependency:** this issuance model is load-bearing on Sybil resistance. Humanity proof is modelled as a **continuous score, not a boolean flag** — accounts start at zero and must cross a minimum threshold before the welcome mint is unlocked. The score accumulates through multiple independent signals (social account attestation, web-of-trust vouching, network tenure, community vouching events, and others). No single mechanism needs to be perfect; the aggregate score is what matters. See Part 6 for candidate signal sources and design detail.

This is the highest-risk implementation dependency in the base design.

### Supply dynamics and value

Total supply grows linearly with verified human participants. Economic activity in a network tends to grow superlinearly with network size (Metcalfe's Law — $n^2$ connections for $n$ participants). If transaction density grows faster than supply, purchasing power of all WEAVE appreciates over time — for every holder equally.

This produces a clean and honest value proposition: **WEAVE's purchasing power reflects the collective productive activity of the network**. It does not favour early holders through halving mechanics or any permanent structural advantage. Everyone's balance appreciates as the network grows.

Early participants who stay active do accrue real advantages, but through activity — staking yield, economic opportunity, accumulated governance weight — not through timing alone.

### Monetary design: anti-concentration properties

The following structural properties are embedded at the protocol level to prevent concentration that would eventually corrupt governance:

- **Economic transaction tax** (see below) funds a global pool — every economic act contributes to the commons. This pool is then redistributed outward through financial irrigation: flows reach every verified human via the UBD, communities via the Synergy Fund allocation, and infrastructure contributors via bounty rewards
- **Universal basic dividend** — a fixed periodic payment distributed equally to every verified human, regardless of balance or stake. Everyone receives the same share of the commons regardless of what they hold
- **Community tax layer** — communities may add their own 1–5% tax on local transactions, flowing into a community pool for locally-governed distribution. The global 1% always applies; the community layer is additive
- **Governance is one person, one vote** — proof-of-humanity is the only requirement to vote. Wealth, staking balance, and tenure confer no governance advantage. Economic power and political power are structurally separated
- **Governance protocols are not baked into the base layer** — the protocol provides the voting primitive (verified human = one vote); how communities and the network choose to organise above that (reputation systems, liquid democracy, delegative models, etc.) is left to experimentation and governance evolution
- **Staking yield** — holders who lock tokens receive yield paid from the global fee pool. The rate is tied to pool size (more economic activity → higher yield), subject to a decaying ceiling (8% in years 1–2, ramping down to 2% by year 7+). In early years, a time-limited inflation subsidy (minting new WEAVE) tops up yield if fee revenue is insufficient — this is pre-committed, explicitly announced at launch, and not renewable without a governance vote. Yield is _not_ redistributive; it is a return proportional to stake size that incentivises long-term commitment and reduces speculative circulation

### Taxation: economic transactions only

A 1% global tax applies to all economic transactions only. Social and knowledge-work interactions are explicitly exempt:

**Taxed:**

- Tipping and direct payments between agents
- Goods and services exchange
- AD4M hosting fees
- AI/compute service payments
- Sub-currency creation and trading
- Large stake movements (above a threshold)

**Not taxed:**

- Creating posts, blocks, or perspectives
- Reacting, commenting, linking content
- Following, joining communities
- Searching, reading, browsing

This distinction is foundational. Taxing knowledge work would create hostile friction at exactly the layer where WE needs to be frictionless. Taxing economic exchange is legitimate and aligns with the principle that extracted value should partially return to the commons.

**Community layer tax:** communities may add their own additional tax on transactions within their neighbourhood, flowing into their own community pool. The global 1% always applies regardless. For cross-community transactions, the destination community's local tax applies; both communities do not double-tax.

A protocol-level ceiling on community tax (5%) could be enforced to prevent extractive community governance from driving out economic activity.

### The global fee pool and its flows

All global 1% tax revenue accumulates in a single global pool. This pool has four outflows:

1. **Core development** — a defined allocation to fund ongoing protocol development, security audits, and core team contributors; governed by the network and subject to the same transparency and governance as all other outflows
2. **Universal basic dividend** — a fixed equal payment distributed periodically to every verified human in the network
3. **Staking yield** — paid to token holders who stake (see below); proportional to stake, not redistributive
4. **Bounties** — paid for verifiable network-growth contributions (see below)
5. **Synergy Fund** — periodic allocation to cross-community collaborative projects (governance mechanism for this allocation is an open design decision)

The pool is a commons. Its governance is itself a collective coordination problem — an instance of the thing ADAM and WE are trying to enable.

### Staking yield

Staking means locking a portion of your WEAVE in a contract for a defined period. The locked tokens cannot be spent. In return, the global pool pays yield on the staked balance.

**Yield source:** the global fee pool is the sole sustainable source of yield. In the early network (years 1–3), when transaction volume is low, a bootstrap inflation subsidy (minting new WEAVE) tops up yield to the published rate if needed. This subsidy is time-limited, explicitly announced at launch, and ends on a fixed schedule.

**Yield rate:** yield is a function of the pool balance, not a fixed number:

$$\text{Yield rate} = \frac{\text{Pool balance}}{f \times S}$$

Subject to a floor (0.5%) and an initial ceiling (8%, decaying to 3% at network maturity). This auto-balances the system — the pool never pays more than it earns. When the network's economy is thriving, staking returns are better. When it contracts, they fall. Yield is literally a share of collective economic productivity.

**Decaying ceiling schedule (indicative):**

| Network year | Maximum yield rate |
| ------------ | ------------------ |
| 1–2          | 8%                 |
| 3–4          | 5%                 |
| 5–6          | 3%                 |
| 7+           | 2% (floor 0.5%)    |

**Incentive to stake:** beyond yield, staking signals long-term commitment and keeps tokens out of speculative circulation, which supports the currency's stability. It does not confer governance advantage — voting power remains one person, one vote regardless of stake size.

**The numbers work out:** at even conservative monetary velocity (5× annually), the 1% fee generates revenue approximately 6× the cost of 2% yield at 40% staking rate. The pool is solvent with significant surplus for bounties and the Synergy Fund at mature network scale. The risk period is year one, which is what the bootstrap subsidy covers.

### Network growth bounties

A defined allocation of the global pool is periodically distributed as bounties for verifiable, AI-resistant network-growth contributions:

- **Referral bounties:** verified new humans who join attributed to you (on-chain verifiable)
- **Infrastructure bounties:** running nodes, providing storage or compute (verifiable)
- **Bug and security bounties:** verified fixes deployed to production (verifiable)
- **Ecosystem bounties:** open tooling, bridges, language integrations — verified by usage metrics, not self-report
- **Geographic/linguistic expansion bounties:** first N verified participants in a given region or language community

Note what is absent: nothing resembling "best idea" or "most valuable contribution to the knowledge graph." Those are qualitative judgements that are gameable and AI-corrodible. All bounties here are anchored in growth facts. CI-quality rewards belong to SynergyFuel.

---

## Part 2 — SynergyFuel (application-layer currency)

### Philosophy

SynergyFuel is where the collective intelligence vision lives as an explicit economic mechanism. It is earned through measurable contributions to the network's collective intelligence — adding to shared knowledge graphs, finding semantic synergies between communities' second-brain graphs, peer-validating novel ideas, helping communities build and organise their knowledge base, and cross-community collaborative work. Its value is explicitly tied to the network's productive output.

The name earns its place at this layer: SynergyFuel is earned by producing synergy and spent to fuel more of it.

Because it sits at the application layer rather than the monetary base, its contribution measurement mechanisms can evolve, fail, be redesigned, and be improved over time without touching the base currency. If the SynergyFuel mechanism turns out to be gameable or theoretically wrong, you fix it here without a catastrophic monetary event.

This is at the heart of why SynergyFuel must not be the base currency. Any contribution metric that can be described becomes a target — and once it is a target, it ceases to measure the thing it was designed to measure (Goodhart's Law). Encoding a specific theory of collective intelligence value into the monetary base is not only philosophically challenging and inherently reductive but also means that theory will be optimised against, and the correlation between the metric and actual CI output will decay. At the application layer, a broken mechanism can be fixed or replaced. At the base layer, it cannot be unwound without hard forking.

The AI dimension compounds this significantly. Any token reward for "novel ideas", "semantic contributions", or "knowledge graph additions" already faces, and will increasingly face, a deluge of LLM-generated content at near-zero marginal cost. The cost to produce a thousand plausible-looking CI contributions is approaching zero. Mitigations exist — community consent signals, cross-validator agreement, anchoring novelty to genuine interaction history — but they add complexity and new attack surfaces, and the adversarial capability is growing faster than the defences. A contribution-based base currency would become progressively less trustworthy as AI capabilities scale. SynergyFuel inherits this risk, but the damage is contained to the application layer where design can evolve.

The downstream effect of both failure modes — Goodhart gaming and AI flooding — is the same: economic power concentrates toward whoever can most efficiently produce the rewarded signals, first to power users who optimise aggressively, then increasingly to AI agents operating at a scale no human can match. A contribution-based base currency in a world of super advanced AI will structurally transfer monetary power away from the human participants it was designed to serve. At the application layer this is a governance crisis. At the base layer it is an existential one.

### Relationship to WEAVE

WEAVE is the monetary base; SynergyFuel is a claim on the network's collective intelligence layer, earned by contributing to it. The dependency is asymmetric: WEAVE exists independently of SynergyFuel, but SynergyFuel's value is underwritten by WEAVE being the reserve. If the SynergyFuel mechanism fails or is replaced, WEAVE is unaffected. The reverse is not true. This asymmetry is intentional — it is what makes the application layer safe to experiment with.

The structural relationship:

- **WEAVE funds the Synergy Fund** — a defined share of the global WEAVE fee pool flows to the Synergy Fund, meaning the CI layer is literally sustained by the base economy's productive activity
- **WEAVE is required to launch** — creating a community neighbourhood or a SynergyFuel-denominated sub-currency requires a WEAVE stake as collateral
- **SYF is exchangeable for WEAVE** — SynergyFuel can be converted to WEAVE at a market rate (the specific exchange mechanism — AMM, order book, or protocol-managed rate — is an unresolved design decision)

**Why hold SYF rather than immediately converting to WEAVE?** Because SynergyFuel has distinct utility within the network that WEAVE does not provide: it is the currency of participation in the CI layer. Paying for AI/compute services, applying for Synergy Fund allocations, launching sub-currencies, and accessing elevated cross-community governance all require SYF. Holding it is a stake in the CI economy, not just a speculative position.

"WEAVE powers SynergyFuel" is an architectural and narrative truth simultaneously.

---

## Part 3 — Community currencies

Communities may issue their own tokens built on top of WEAVE or SynergyFuel. These are fully unconstrained at the design level — communities experiment with whatever contribution measurement, distribution, and governance mechanisms they choose.

This is where CI issuance experiments can run in low-stakes environments. A community that believes it has found a good CI measurement mechanism can implement it in their own token. If it works, it informs SynergyFuel's governance evolution. If it fails, the failure is contained.

The protocol provides:

- Standard sub-currency creation primitives (stake WEAVE to launch)
- Community tax layer (1–5% on transactions within the neighbourhood)
- Governance tooling for community-defined distribution rules
- Block provenance data as raw input for custom contribution algorithms

---

## Why this combination is the optimal design

The previous tradeoff analysis identified a core dilemma: Path B (contribution-based issuance) is a more compelling founding story but relies on a gameable and AI-corrodible mechanism. Path A (proof-of-humanity issuance) is a more durable foundation but provides no protocol-level answer to "why this currency."

The dual-currency design resolves this dilemma by assigning each answer to the layer where it belongs.

WEAVE answers the durability question. Its issuance is tied to the one thing that cannot be automated — the growth of verified human participation. It does not require a theory of what makes a contribution valuable, and it does not become less trustworthy as AI capabilities scale. It is the right design for a monetary base precisely because it is simple, legible, and AI-resistant by construction. The honest founding narrative is not "this currency rewards intelligence" — it is "this currency belongs to the humans building the network, and its value reflects their collective productive activity."

SynergyFuel answers the narrative question. It gives the CI vision an explicit economic expression — tokens earned through genuine contributions to shared knowledge, semantic discovery, and cross-community collaboration. It answers "why this network?" at the protocol level in a way WEAVE alone cannot. And crucially, because it sits at the application layer, its mechanisms can evolve as the field matures and as AI capabilities shift the threat landscape. A broken SynergyFuel mechanism is a design problem. A broken WEAVE mechanism would be a monetary catastrophe.

Neither path alone was sufficient. Path A was a foundation without a story. Path B was a story without a foundation. The dual-currency architecture gives each the layer it needs to be honest.
