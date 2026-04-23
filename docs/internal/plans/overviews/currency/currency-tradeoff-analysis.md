# WE Currency Strategy: Tradeoff Analysis

Two broad paths for the AD4M native currency have been considered. This document steelmans both and works through the tradeoffs.

---

## Path A — General-purpose currency with proof-of-humanity issuance

**Core mechanic:** New tokens are minted as the network of verified unique humans grows. Micro-fees on economic transactions (goods/services exchange, tipping, sub-currency creation and trading) accumulate in a network commons pool. The definition of what counts as a valuable contribution is left to communities and users: they tip, trade, and optionally build sub-currencies on top of the core currency tied to whatever CI metrics they choose.

**Steelman:**

The strongest version of this argument is that it mirrors AD4M and WE's own architectural philosophy. The design principle is: define clean, simple primitives at the protocol layer and let communities define value at the edges. A currency with the same structure — neutral issuance mechanics at base, community-defined contribution accounting on top — is internally coherent in a way Path B is not.

The issuance trigger (verified unique humans) is **AI-resistant by construction**. You cannot LLM your way into being a new human. This property becomes increasingly important as AI capabilities scale: any contribution-based issuance trigger that can be described in natural language will eventually be automatable.

It also avoids Goodhart's Law at the most dangerous layer. Goodhart's Law says: any measure that becomes a target ceases to be a good measure. Encoding a specific theory of collective intelligence value into the mint means that theory will be optimised against, and the correlation between the metric and the actual thing will decay. Path A pushes that risk down to optional community layers, where experiments can run and fail without corrupting the base layer.

The commons pool (funded by micro-fees) preserves the CI alignment story without baking it into issuance. Commons governance can evolve its own allocation mechanisms — distributing to communities that demonstrate the kinds of contributions the network values — and those mechanisms can be updated as the field matures, without touching the monetary base.

---

## Path B — Contribution-based issuance tied to collective intelligence

**Core mechanic:** Tokens are released as rewards for measurable contributions to collective intelligence: adding to the shared knowledge graph, finding semantic synergies between communities' second-brain graphs, peer-validating novel ideas, etc. The currency's scarcity and value are explicitly tied to the network's productive output.

**Steelman:**

The strongest version of this argument is that it solves the bootstrapping and motivation problem that Path A cannot. In year one, "this currency is valuable because of the network" is circular — the network is small, so the currency has no intrinsic claim. Path B creates an artificial demand signal from day one: do CI work, receive tokens. That gives early adopters a reason to hold rather than dump, and a reason to do the hard work of seeding the knowledge graph.

It also answers the hardest question cleanly: _why this currency and not others?_ Path B has an explicit protocol-level answer — this currency is earned through AI-assisted collective knowledge work; no other currency has that provenance. That is a genuinely differentiating founding story.

The "second-brain graph" mechanism is architecturally native in a way most CI measurement schemes are not. Because AD4M already generates block provenance attribution, semantic graph structure, and cross-community linking data, a contribution measurement system would be reading real exhaust from natural usage rather than requiring artificial proof-of-work rituals.

---

## The core tension

Both paths are trying to achieve the same thing: a currency that **embodies** the vision of collaborative, human-centred collective intelligence. They differ on whether that embodiment lives at the _issuance layer_ (Path B) or at the _architectural and governance layer_ (Path A).

The tension can be stated precisely:

> Path B is a more compelling founding story but relies on a gameable and AI-corrodible mechanism. Path A is a more durable foundation but provides no protocol-level answer to "why this currency."

---

## Tradeoff comparison

| Dimension                                | Path A (General + humanity proof)         | Path B (CI-contribution issuance)              |
| ---------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Architectural coherence with ADAM and WE | High — neutral base, community edges      | Lower — embeds one theory of value permanently |
| AI-resistance of issuance trigger        | High (unique humans)                      | Low and declining                              |
| Gameable?                                | Sybil attacks on identity layer           | Increasingly yes as LLMs scale                 |
| Answers "why this currency"?             | Through network effects only              | Yes, at the protocol level                     |
| Narrative clarity in year one            | Weaker                                    | Stronger                                       |
| Long-term validity of the mechanism      | Durable                                   | Goodhart's Law corrodes it                     |
| CI alignment                             | Through architecture + commons governance | Through issuance mechanics                     |
| Avoids encoding wrong theory of value    | Yes                                       | No — and it can't be unwound                   |
| Community experimentation                | Yes, via sub-currencies                   | Possible but secondary                         |

---

## Problems neither path fully solves

**Proof-of-humanity is unsolved infrastructure.** Path A's issuance model is load-bearing on this. This cannot be hand-waved. Path A's entire supply model breaks if Sybil resistance fails.

**Cold-start network value.** Path A's "currency is valuable because of the network" is circular in year one. Path B's contribution rewards create artificial demand but will be gamed from the start. Neither has a clean answer to early liquidity and adoption.

**AI flooding (Path B-specific).** Any token reward for "novel ideas" or "semantic contributions" faces a deluge of LLM-generated content at near-zero marginal cost. Mitigations exist (anchoring novelty to community interaction history, requiring cross-community validator agreement) but add complexity and new attack surfaces.

**Oracle centralisation (Path B-specific).** Someone has to evaluate whether a contribution was genuinely novel or synergistic. Centralised oracles are corruptible; decentralised ones are hard to coordinate. This is an open research problem.

**Category error (Path B-specific, fundamental).** Collective intelligence is an emergent property of a system — it is not decomposable into scoreable individual contributions. Any measurable proxy for it will diverge from the real thing as the incentive gradient shapes behaviour. The part of collective intelligence that is durably irreducible to measurement is "lived stakes and consequential commitment" — bearing risk, entering relationships, accepting responsibility. These cannot be scored by a token system.

---

## Where this analysis leads

The cold-start problem and the narrative weakness of Path A are resolved — not by choosing one path over the other, but by a dual-currency architecture that assigns each answer to the layer where it belongs. WEAVE (proof-of-humanity base currency) provides the durable, AI-resistant foundation. SynergyFuel (application-layer CI currency) provides the protocol-level narrative and the explicit economic expression of the CI vision. See the full design in [dual-currency-proposition.md](./dual-currency-proposition.md).
