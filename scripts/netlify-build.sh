#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Netlify build. Every build installs the @coasys/ad4m and @coasys/ad4m-connect this
# repo pins, except a deploy preview whose pull request pairs itself with an ad4m
# change. That preview builds both packages from that change and links them into
# the workspace before running the normal build.
#
# A pull request pairs itself with a block at the top of its description:
#
#   > [!IMPORTANT]
#   > ### Paired with: coasys/ad4m#1187
#
# naming an ad4m pull request (its head, or its merge commit once merged), or
# `coasys/ad4m@some-branch` for an ad4m branch, tag or commit. It must be the first
# thing in the description; scripts/ad4m-pairing.mjs has the exact rules.
#
# The description rather than a label or a matching branch name: it is visible to reviewers,
# it is there before the first build, several WE pull requests can name one ad4m pull
# request, and nothing is paired by accident. Editing it does not rebuild the preview;
# push again, or use "Retry deploy".
#
# Why only previews: the pin says "this WE was built and tested against this ad4m",
# and merging the pull request that set it is the confirmation. A build from another
# ad4m changes whenever that repository does, cannot be reproduced, and was never
# tested by CI. See docs/contributing/ad4m-and-deploys.md.
#
# Nothing here reaches the required build, which installs the lockfile and stops: see
# the comment on `Install dependencies` in .github/workflows/build.yaml for why a
# branch of another repository must not decide whether a WE change merges.
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
AD4M_REPO='coasys/ad4m'
DIST="$WE_ROOT/apps/we-web/dist"

# Public repositories need no token, but unauthenticated requests share a small
# per-address limit. A GITHUB_TOKEN set on the site raises it.
github_api() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -sf -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/$1"
  else
    curl -sf "https://api.github.com/$1"
  fi
}

# Reads one field of a JSON document on stdin, or prints nothing.
json_field() {
  node -e "
    let s = ''; process.stdin.on('data', c => (s += c)).on('end', () => {
      try {
        const v = ($1)(JSON.parse(s));
        console.log(v ?? '');
      } catch { console.log('') }
    })
  "
}

# --- Which ad4m, and why -----------------------------------------------------

# Netlify sets BRANCH to `pull/N/head` on a deploy preview, so the pull request is the
# only reliable place to read the head branch, and it carries the description too.
PR_JSON=''
if [ "${CONTEXT:-}" = 'deploy-preview' ] && [ -n "${REVIEW_ID:-}" ]; then
  PR_JSON="$(github_api "repos/$WE_REPO/pulls/$REVIEW_ID" || true)"
  if [ -z "$PR_JSON" ]; then
    echo "  could not read $WE_REPO#$REVIEW_ID from the GitHub API; building against the pin"
  fi
fi

WE_BRANCH="${BRANCH:-${HEAD:-}}"
if [ -n "$PR_JSON" ]; then
  WE_BRANCH="$(printf '%s' "$PR_JSON" | json_field 'pr => pr.head?.ref')"
fi

# The pairing, if the description has one. Read by scripts/ad4m-pairing.mjs, which the CI jobs
# share, so the preview and CI cannot disagree about whether this pull request is paired. A pairing
# it cannot read, or a pull request that cannot be found, fails the build rather than silently using
# the pin: that would give a preview that looks paired and is not.
AD4M_REF='pin'
REASON="a ${CONTEXT:-local} build uses the pin"

if [ -n "$PR_JSON" ]; then
  PAIRING_OUT="$(printf '%s' "$PR_JSON" | json_field 'pr => pr.body' | node "$WE_ROOT/scripts/ad4m-pairing.mjs" --resolve)" || exit 1
  if printf '%s\n' "$PAIRING_OUT" | grep -qx 'paired=true'; then
    AD4M_REF="$(printf '%s\n' "$PAIRING_OUT" | sed -n 's/^ref=//p')"
    REASON="$(printf '%s\n' "$PAIRING_OUT" | sed -n 's/^reason=//p')"
  fi
fi

echo "── ad4m: $AD4M_REF ($REASON)"

# --- Build ------------------------------------------------------------------

# Read before anything rewrites it: the source path points the override at the
# local build, so asking afterwards answers `link:…` rather than what is pinned.
PINNED_VERSION="$(node -p "require('./package.json').pnpm.overrides['@coasys/ad4m']")"
WE_VERSION="$(node -p "require('./package.json').version")"

AD4M_SHA=''

if [ "$AD4M_REF" = 'pin' ]; then
  echo "── Build WE against the pinned SDK"
else
  echo "── Fetch $AD4M_REPO ($AD4M_REF)"
  # A fetch of one ref rather than `git clone --branch`, which cannot take a commit
  # or a pull request ref.
  rm -rf "$AD4M_DIR"
  git init -q "$AD4M_DIR"
  git -C "$AD4M_DIR" fetch -q --depth 1 "https://github.com/$AD4M_REPO.git" "$AD4M_REF"
  git -C "$AD4M_DIR" checkout -q FETCH_HEAD
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

  echo "── Build @coasys/ad4m-connect from source"
  # The app's PerspectiveProxy comes from ad4m-connect, not from @coasys/ad4m:
  # connect bundles the SDK it was built against (esbuild, bundle: true). So an
  # SDK fix reaches the running app only through a connect built from the same
  # revision — the pinned connect carries whatever SDK it was published with.
  #
  # connect's src/utils.ts reads the version from the repo root package.json,
  # removed above so npm treats core/ as standalone. Put back a minimal one:
  # the version, and no workspaces for a package manager to walk into.
  AD4M_VERSION="$(git -C "$AD4M_DIR" show HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"
  printf '{"name":"ad4m-source-build","private":true,"version":"%s"}\n' "$AD4M_VERSION" > "$AD4M_DIR/package.json"
  cd "$AD4M_DIR/connect"
  # Bundle the SDK built above, not the one connect's manifest names.
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.devDependencies['@coasys/ad4m'] = 'link:../core';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  # --ignore-scripts as for core: pnpm 10 otherwise fails the install over
  # esbuild's unapproved install script, and esbuild's binary arrives through
  # its optional platform package regardless.
  pnpm install --ignore-workspace --no-frozen-lockfile --ignore-scripts
  NODE_ENV=production pnpm run build
  echo "  built: $(ls dist/index.js dist/core.js 2>/dev/null | wc -l)/2 bundles"

  echo "── Link local SDK into WE workspace"
  cd "$WE_ROOT"

  # Rewrite the pnpm override to point at the local build.
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.pnpm.overrides['@coasys/ad4m'] = 'link:${AD4M_DIR}/core';
    pkg.pnpm.overrides['@coasys/ad4m-connect'] = 'link:${AD4M_DIR}/connect';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('  override:', pkg.pnpm.overrides['@coasys/ad4m'], pkg.pnpm.overrides['@coasys/ad4m-connect']);
  "

  # Re-resolve with the rewritten override. --no-frozen-lockfile because the
  # lockfile no longer matches the manifest (expected — the override changed).
  pnpm install --no-frozen-lockfile

  echo "── Build WE"
fi

NODE_OPTIONS='--max-old-space-size=8192' pnpm build

# --- Say what this build is -------------------------------------------------
#
# A page built from "ad4m at the time" is otherwise unexplainable a week later, and a
# tester hitting RPC failures has no way to tell a WE bug from an SDK the executor in
# front of them does not match. Both halves are written: /build-info.json for anything
# that wants to read it, and a console line for the person who has the page open.

BUILD_INFO_SOURCE='pin'
[ "$AD4M_REF" = 'pin' ] || BUILD_INFO_SOURCE='source'

export DIST BUILD_INFO_SOURCE AD4M_REF AD4M_SHA PINNED_VERSION WE_BRANCH WE_VERSION

node -e "
  const fs = require('fs');
  const path = require('path');
  const dist = process.env.DIST;
  if (!fs.existsSync(dist)) {
    console.warn('  no dist directory — skipping build info');
    process.exit(0);
  }

  const info = {
    weVersion: process.env.WE_VERSION,
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
      ? \`WE \${info.weVersion}, with @coasys/ad4m and ad4m-connect built from \${info.ad4mRef}@\${(info.ad4mSha || '').slice(0, 9)} — NOT the pinned \${info.ad4mPinned}\`
      : \`WE \${info.weVersion}, with @coasys/ad4m \${info.ad4mPinned} (pinned)\`;

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
