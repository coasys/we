# What the host keeps

Almost everything on screen can come from somebody else: a space's template, a theme, a seed's
white-labelled chrome, and in time a whole app installed as data. The design goal is to let all of it
be customised except the few things that protect the person using it. This is the list of those
things, how each one is enforced, and what to do when adding to it.

The rule behind every entry is the same: **a protection only counts if it holds without the thing it
protects against cooperating.** None of these asks a template, a theme, a component or a module to
remember anything. Each is enforced at one chokepoint the host owns.

## The list

| What                       | Why it cannot be handed over                                                 | Where it is enforced                                                      |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **The password field**     | A field a template draws can keep what is typed and send it on               | `CredentialField`, `credential.ts`; `login`/`createAgent` are wiring      |
| **The safety prompts**     | A question drawn or covered by the thing it is asking about is worth nothing | `PROTECTED_SLOTS`, the prompt layer in `TemplateProvider`, `top-layer.ts` |
| **The way out**            | An interface can hide every exit, or hang the page while it renders          | `safeMode.ts`, `commitTemplate`, `allThemes`                              |
| **What a template may do** | The person decides what an installed template may reach, not its author      | `templateSurface.ts`                                                      |

The last is older than the others and has its own long docblock. The rest of this page is about the
first three.

## The password field

A sign-in screen can be redrawn: a seed replaces `core:bootScreen`, and an installed app will be able
to draw its own. Drawing it is fine. Holding the password is not, and the attack needs nothing
exotic. A template's own field, bound to `$localState` with `"persist"`, survives in localStorage
after sign-in unmounts it, and once the agent is unlocked a `record.create` can write it into a
shared space.

So the field is the host's. A screen places `CredentialField` like any component and cannot replace
it or read it:

- **The value never becomes template state.** It goes to `credential`, a module that is not a store,
  prop or event, so no expression can see it.
- **No event carries it out.** `we-input`'s `input`, `change` and `keydown` carry the value or the
  key, and they bubble, so a wrapping node with an `onInput` would read every keystroke. Every input
  and key event stops at the field. A schema cannot attach a capturing listener, and the host's own
  gesture tracking listens in the capture phase, so neither is affected.
- **No action takes a password.** `sessionStore.unlock()` and `profileStore.completeAccountSetup(name)`
  read the held value. `login(password)` and `createAgent(password)` are host wiring, absent from
  every bag. An action that accepted a password as an argument would accept one a template's own
  field collected.

What a template gets is `onEdit` and `onSubmit`, which carry nothing, and two booleans:
`credentialEntered` and `credentialConfirmed`.

This does not stop a screen drawing a convincing fake field of its own and collecting what is typed
into it. It means that field cannot sign anybody in, so the person notices.

**Condition.** A redrawn sign-in screen is safe on the desktop partly because the menu bar, which
the operating system draws, is where the way out lives. If sign-in comes to the web, this needs
revisiting before it ships.

## The safety prompts

`core:consentPrompt`, `consentSecret`, `installPrompt`, `destructivePrompt`, `screenSource` and
`removeAccount` ask a person a question whose answer protects them. Three things keep them the
host's:

1. **Nothing can replace them.** The slot registry refuses `replace`, `remove` and re-`register` for
   anything in `PROTECTED_SLOTS`. A seed white-labels the rest of the chrome; it is refused these.
2. **Nothing can be drawn over them.** Modals live in the browser's top layer, which stacks by
   arrival rather than by `z-index`, so whatever enters last is on top. A template can open an
   overlay with nobody touching anything: `$setLocal` is not gated, and `onAnimationEnd` fires by
   itself. `@we/primitives/top-layer` wraps `showPopover` and `showModal` once, at boot. While the
   host holds the top layer, anything outside the holder that asks to enter waits until the hold is
   released, and an unshown popover is `display: none` in the meantime. Taking the hold also raises
   the holder's own popovers, because a template can raise a prompt and mount a sheet in the same
   handler.
3. **Nothing behind them responds.** The prompts render in a layer of their own after everything
   else. While one is open, that layer holds the top layer and the rest of the app is `inert`.

The prompt layer knows a prompt is open by looking at its own DOM, so **a new safety prompt is one
more id in `PROTECTED_SLOTS`** and gets all three.

**A template does not ask first.** The host's delete prompt is in front of every destructive action
a space template runs, so a template's own "are you sure?" in front of one is a second question about
the same click. Call the action from the control; the validator warns about a `we-modal` that
confirms one. What the template's dialog used to say, the host says: `describeDestructive` writes the
question, and for a `deleteCollection` it first counts what goes with the record (`collectionFacts`
— whether it is a reply, and how many responses sit under it), so "Delete this reply and the 3
responses under it?" comes from the data rather than from the template. Chrome is judged without
this rule (`asHostChrome`): its bag has no host prompt in front of it, so its own dialog is the
only question.

## The way out

Safe mode draws WE's own templates and themes in place of the chosen ones, for the tab, until
somebody leaves it. Nothing is changed or deleted. There are four ways in:

| Door                         | For                                                                       |
| ---------------------------- | ------------------------------------------------------------------------- |
| `?safe` on any address       | Anything. Read before the first template is committed.                    |
| Ctrl+Alt+Shift+S (⌘⌥⇧S)      | An interface that loads fine and offers no way out.                       |
| A render that never finished | A template that hangs or crashes the page. Needs nobody to know anything. |
| Help → Restart in Safe Mode  | The desktop app. It opens the `?safe` address.                            |

- **Decided once, before anything runs.** `safeMode()` reads the address, the tab's memory and the
  render record the first time it is asked, which is as `TemplateStore` is created. A
  `history.replaceState` from a template later cannot undo it.
- **The key** is heard on the window in the capture phase, before a focused field or a component
  stopping propagation can see it.
- **The render record** is written by `commitTemplate` before a template renders. It is cleared once
  the app has stayed responsive for `SETTLE_MS`, once the template is replaced, or when the page is
  left with JavaScript running. Only a page that hung or crashed leaves it behind. Records name
  their tab, so a second tab opened mid-render does not read the first one's render as a hang.
  Another tab's record counts only after `STALE_MS`, which also covers a desktop relaunch.
- **Enforced at the one door for each.** `commitTemplate` is the only way a schema becomes the live
  template, and every theme id resolves through `allThemes`. In safe mode the first commits the
  bundled template in place of anything else, and the second lists only the built-in themes. The
  settings page still lists custom themes, so they can be deleted from safe mode.

On the web the address bar is the one piece of the window a page cannot draw over. On the desktop it
is the menu bar. Both doors lead to the same `?safe` address.

## Adding to the list

Before adding a protection, ask who would have to cooperate for it to hold. If the answer is a
template, a component or a module, it does not hold yet. Find the one place everything has to pass
through, which may be a registry, a commit, a prototype method or an event phase, and enforce it
there. Then prove it by planting the fault the protection exists for and running the real thing:
each test in `topLayer.browser.test.ts`, `credentialField.test.tsx` and `safeMode.test.ts` was
checked to fail with its mechanism removed.
