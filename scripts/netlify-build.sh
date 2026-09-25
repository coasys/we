#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Netlify deploy-preview build — optionally builds @coasys/ad4m from source and
# links it into the WE workspace before running the normal build.
#
# Why: WE's pnpm override pins a published pre-release tag of the SDK, and that
# tag only moves when somebody hand-publishes one from an ad4m commit. New SDK
# work — batch RPC endpoints, performance fixes — lands on ad4m's branches well
# before that happens, so a preview built against the pin cannot exercise it.
#
# Which ad4m a preview gets, in the order the answers are consulted:
#
#   1. AD4M_BRANCH in the Netlify UI — site-wide, overrides everything below.
#   2. A `preview:ad4m@<ref>` label on the pull request. `preview:ad4m@pin` means
#      "use the version this repo pins", for a branch whose whole point is that
#      pin. A label rather than a committed marker file because it cannot merge:
#      the file would land on `dev` and go on governing every later preview.
#   3. An ad4m branch of the same name as the WE branch — the cross-repo case,
#      where the two halves of one change are being written together.
#   4. `dev`.
#
# Nothing here reaches the required build, which installs the lockfile and stops:
# see the comment on `Install dependencies` in .github/workflows/build.yaml for
# why a branch of another repository must not decide whether a WE change merges.
# ---------------------------------------------------------------------------
set -euo pipefail

echo "── Environment"
echo "  node: $(node --version)"
echo "  npm:  $(npm --version)"
echo "  pnpm: $(pnpm --version 2>/dev/null || echo 'not found')"
echo "  git:  $(git --version)"
echo "  pwd:  $PWD"

AD4M_DIR="/tmp/ad4m-sdk"
WE_ROOT="$PWD"
WE_REPO="${WE_REPO:-coasys/we}"
DIST="$WE_ROOT/apps/we-web/dist"

# --- Which ad4m, and why -----------------------------------------------------

# Netlify sets BRANCH to `pull/N/head` on a deploy preview, so the PR is the only
# reliable place to read the head branch — and it carries the labels too. One
# request answers both; a private repo would need a token, this one does not.
PR_JSON=''
if [ -n "${REVIEW_ID:-}" ]; then
  PR_JSON="$(curl -sf "https://api.github.com/repos/$WE_REPO/pulls/$REVIEW_ID" || true)"
fi

WE_BRANCH="${BRANCH:-${HEAD:-}}"
if [ -n "$PR_JSON" ]; then
  WE_BRANCH="$(printf '%s' "$PR_JSON" | node -e "
    let s = ''; process.stdin.on('data', c => (s += c)).on('end', () => {
      try { console.log(JSON.parse(s).head?.ref ?? '') } catch { console.log('') }
    })
  ")"
fi

AD4M_REF=''
REASON=''

if [ -n "${AD4M_BRANCH:-}" ]; then
  AD4M_REF="$AD4M_BRANCH"
  REASON='AD4M_BRANCH is set in the Netlify UI'
fi

if [ -z "$AD4M_REF" ] && [ -n "$PR_JSON" ]; then
  LABEL_REF="$(printf '%s' "$PR_JSON" | node -e "
    let s = ''; process.stdin.on('data', c => (s += c)).on('end', () => {
      let labels = [];
      try { labels = JSON.parse(s).labels ?? [] } catch {}
      const hit = labels.map(l => l.name ?? '').find(n => n.startsWith('preview:ad4m@'));
      console.log(hit ? hit.slice('preview:ad4m@'.length) : '');
    })
  ")"
  if [ -n "$LABEL_REF" ]; then
    AD4M_REF="$LABEL_REF"
    REASON="the PR carries the label preview:ad4m@$LABEL_REF"
  fi
fi

if [ -z "$AD4M_REF" ] && [ -n "$WE_BRANCH" ]; then
  if git ls-remote --exit-code --heads \
    https://github.com/coasys/ad4m.git "$WE_BRANCH" >/dev/null 2>&1; then
    AD4M_REF="$WE_BRANCH"
    REASON="coasys/ad4m has a branch named $WE_BRANCH too"
  fi
fi

if [ -z "$AD4M_REF" ]; then
  AD4M_REF='dev'
  REASON='nothing asked for anything else'
fi

echo "── ad4m: $AD4M_REF ($REASON)"

# --- Build ------------------------------------------------------------------

# Read before anything rewrites it: the source path points the override at the
# local build, so asking afterwards answers `link:…` rather than what is pinned.
PINNED_VERSION="$(node -p "require('./package.json').pnpm.overrides['@coasys/ad4m']")"

AD4M_SHA=''

if [ "$AD4M_REF" = 'pin' ]; then
  echo "── Build WE against the pinned SDK"
else
  echo "── Clone coasys/ad4m ($AD4M_REF)"
  rm -rf "$AD4M_DIR"
  git clone --depth 1 --branch "$AD4M_REF" \
    https://github.com/coasys/ad4m.git "$AD4M_DIR"
  AD4M_SHA="$(git -C "$AD4M_DIR" rev-parse HEAD)"
  echo "  revision: $AD4M_SHA"

  echo "── Build @coasys/ad4m from source"
  # AD4M's root package.json declares `workspaces` — npm walks up from core/,
  # finds it, and tries to resolve every sibling (ui, connect, …) which use
  # pnpm's `workspace:*` protocol. Strip the workspace context so npm treats
  # core/ as a standalone package.
  rm -f "$AD4M_DIR/package.json" "$AD4M_DIR/pnpm-workspace.yaml"
  cd "$AD4M_DIR/core"
  npm install --ignore-scripts
  npx patch-package
  npx tsc
  npx rollup -c rollup.config.js
  echo "  built: $(ls lib/index.cjs 2>/dev/null && echo 'ok' || echo 'MISSING')"

  echo "── Link local SDK into WE workspace"
  cd "$WE_ROOT"

  # Rewrite the pnpm override to point at the local build.
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.pnpm.overrides['@coasys/ad4m'] = 'link:${AD4M_DIR}/core';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('  override:', pkg.pnpm.overrides['@coasys/ad4m']);
  "

  # Re-resolve with the rewritten override. --no-frozen-lockfile because the
  # lockfile no longer matches the manifest (expected — the override changed).
  pnpm install --no-frozen-lockfile

  echo "── Build WE"
fi

NODE_OPTIONS='--max-old-space-size=8192' pnpm build

# --- Say what this preview is -----------------------------------------------
#
# A page built from "ad4m dev at the time" is otherwise unexplainable a week
# later, and a tester hitting RPC failures has no way to tell a WE bug from an
# SDK the executor in front of them does not match. Both halves are written:
# /build-info.json for anything that wants to read it, and a console line for
# the person who has the page open.

BUILD_INFO_SOURCE='pin'
[ "$AD4M_REF" = 'pin' ] || BUILD_INFO_SOURCE='source'

export DIST BUILD_INFO_SOURCE AD4M_REF AD4M_SHA PINNED_VERSION WE_BRANCH

node -e "
  const fs = require('fs');
  const path = require('path');
  const dist = process.env.DIST;
  if (!fs.existsSync(dist)) {
    console.warn('  no dist directory — skipping build info');
    process.exit(0);
  }

  const info = {
    ad4mSource: process.env.BUILD_INFO_SOURCE,
    ad4mRef: process.env.AD4M_REF,
    ad4mSha: process.env.AD4M_SHA || null,
    ad4mPinned: process.env.PINNED_VERSION,
    weBranch: process.env.WE_BRANCH || null,
    weCommit: process.env.COMMIT_REF || null,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dist, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

  const summary =
    info.ad4mSource === 'source'
      ? \`@coasys/ad4m built from \${info.ad4mRef}@\${(info.ad4mSha || '').slice(0, 9)} — NOT the pinned \${info.ad4mPinned}\`
      : \`@coasys/ad4m \${info.ad4mPinned} (pinned)\`;

  const indexPath = path.join(dist, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes('</head>')) {
    console.warn('  index.html has no </head> — build info written to build-info.json only');
    process.exit(0);
  }
  const tag =
    \`<meta name=\"we:ad4m-build\" content=\"\${summary.replace(/\"/g, '&quot;')}\">\` +
    \`<script>console.info('[we] ' + \${JSON.stringify(summary)})</script>\`;
  fs.writeFileSync(indexPath, html.replace('</head>', tag + '</head>'));
  console.log('  ' + summary);
" 2>&1
