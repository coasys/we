/**
 * Getting into a space somebody invited you to, on a build with no address bar.
 *
 * On the web a share link is self-executing: the URL *is* the invitation, the browser opens it and
 * the space gate takes over. Nothing about that generalises. The electron app registers no protocol
 * handler at all — no `setAsDefaultProtocolClient`, no `open-url` — so a link cannot reach it under
 * any circumstances, and joining meant knowing to look in Settings → Spaces & data.
 *
 * Asserted against the schemas rather than a render because all of it is a static decision: which
 * doors exist, and that both of them lead to the one dialog the shell holds. The failure mode is
 * silent in the way this repo's chrome bugs usually are — a door that is simply not there.
 */
import { joinSpaceModalMount, sidebar } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

import { settingsTemplate } from '../src/shared/schemas/index';

const sidebarJson = JSON.stringify(sidebar);
const settingsJson = JSON.stringify(settingsTemplate);
const modalJson = JSON.stringify(joinSpaceModalMount);

describe('the way into a space you were invited to', () => {
  it('is offered from the sidebar’s spaces group, beside creating one', () => {
    /*
      Both behind one `+`. Two icons was the alternative and reads worse in a heading that narrow —
      and the point of the change is that joining is *discoverable*, which a second glyph nobody
      recognises does not achieve either.
    */
    expect(sidebarJson).toContain('shellStore.setJoinSpaceOpen');
    expect(sidebarJson, 'creating a space is still offered from the same menu').toContain(
      'shellStore.setCreateSpaceOpen',
    );
    expect(sidebarJson, 'as a menu rather than a bare button').toContain('DropdownMenu');
  });

  it('is offered from settings too, through the same dialog', () => {
    /*
      Settings used to carry its own copy of the form — a labelled input with a Join beside it. Two
      join forms in one app is two things to keep in step, and the sidebar could not have reused a
      field that lived inside a settings page anyway.
    */
    expect(settingsJson).toContain('shellStore.setJoinSpaceOpen');
    expect(settingsJson, 'and not a second copy of the form').not.toContain('neighbourhood:// address');
  });

  it('says what an address can look like, since three forms all work', () => {
    // `joinSpace` takes a share URL, a `neighbourhood://` URI or the bare id out of either. Somebody
    // holding one of them should not have to work out which kind it is.
    expect(modalJson).toContain('neighbourhood://');
    expect(modalJson).toContain('spaceStore.joinSpace');
  });

  it('says a slow join is still working, and why a failed one failed', () => {
    /*
      A first join fetches and installs the whole neighbourhood before it exists locally, which
      routinely takes about a minute. The settings field it replaces showed neither — it span a local
      flag and said nothing — so a slow join was indistinguishable from a hang, which is exactly when
      somebody presses the button a second time.
    */
    expect(modalJson, 'the slow-join line').toContain('spaceStore.joinSlow');
    expect(modalJson, 'and the failure').toContain('spaceStore.joinError');
  });
});

/**
 * A `$part` placed by host chrome, which the settings overlay could not draw.
 *
 * Every surface that renders module-aware schema expands parts before the renderer sees them — the
 * slot registry's nodes, a panel's body, a template's routes. The shell *overlays* were the one that
 * did not, so Settings drew the literal words `Unknown component "$part"` where the call module's
 * device chooser should have been.
 *
 * Asserted against the schema and the resolver rather than a render, because both halves are static:
 * the settings page places a part, and the overlay has to be the kind of surface that expands one.
 */
describe('a module’s part, placed by a settings page', () => {
  it('is what Settings places, rather than importing the module', () => {
    /*
      A template package importing a module would invert the dependency and make an optional
      capability mandatory — the section is gated on `modules.call` precisely because a deployment
      may not have calls. A part is how a surface places something it must not depend on.
    */
    expect(settingsJson).toContain('"call.deviceSettings"');
    expect(settingsJson, 'the section should be gated on the module, not assumed').toContain('modules.call');
  });

  it('is expanded by the overlay before the renderer sees it', async () => {
    // The fix is that `ShellOverlayInner` runs the schema through `resolveParts`. Read as source,
    // because mounting the overlay needs a platform, a router and a full store bag — and what is
    // being pinned is that the call exists at all, which is exactly what was missing.
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync(new URL('../src/frameworks/solid/layouts/TemplateLayout.tsx', import.meta.url), 'utf8');

    expect(layout, 'the shell overlay renders its schema without expanding parts').toContain('resolveParts(');
  });
});
