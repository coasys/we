#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Netlify build. Every build installs the @coasys/ad4m and @coasys/ad4m-connect this
# repo pins, except a deploy preview whose pull request pairs itself with an ad4m
# change. That preview builds both packages from that change and links them into
# the workspace before running the normal build.
#
# A pull request pairs itself with one line in its description:
#
#   ad4m: coasys/ad4m#1187        an ad4m pull request (its head, or its merge
#                                 commit once merged)
#   ad4m: coasys/ad4m@some-branch an ad4m branch, tag or commit
#
# The line rather than a label or a matching branch name: it is visible to reviewers,
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

# The pairing line, if the description has one: `#1187` or `@some-branch`.
PAIRING=''
if [ -n "$PR_JSON" ]; then
  # HTML comments are dropped first: the PR template shows the line as an example inside one.
  PAIRING="$(printf '%s' "$PR_JSON" | json_field "pr => {
    const body = (pr.body ?? '').replace(/<!--[\s\S]*?-->/g, '');
    const m = body.match(/^[ \t]*ad4m:[ \t]*coasys\/ad4m([#@][^ \t\r\n]+)[ \t]*\r?$/im);
    return m ? m[1] : '';
  }")"
fi

AD4M_REF='pin'
REASON="a ${CONTEXT:-local} build uses the pin"

if [ -n "$PAIRING" ]; then
  case "$PAIRING" in
    '#'*)
      AD4M_PR="${PAIRING#\#}"
      if ! [[ "$AD4M_PR" =~ ^[0-9]+$ ]]; then
        echo "── The description names ad4m pull request '$AD4M_PR', which is not a number."
        exit 1
      fi
      AD4M_PR_JSON="$(github_api "repos/$AD4M_REPO/pulls/$AD4M_PR" || true)"
      if [ -z "$AD4M_PR_JSON" ]; then
        # Asked for, so failing is right: silently building against the pin would
        # show a preview that is not what the description says it is.
        echo "── The description pairs this preview with $AD4M_REPO#$AD4M_PR, which could not be read."
        exit 1
      fi
      MERGE_SHA="$(printf '%s' "$AD4M_PR_JSON" | json_field 'pr => pr.merged_at ? pr.merge_commit_sha : ""')"
      if [ -n "$MERGE_SHA" ]; then
        AD4M_REF="$MERGE_SHA"
        REASON="the description pairs it with $AD4M_REPO#$AD4M_PR, which has merged"
      else
        # `pull/N/head` works for a pull request from a fork as well as from a branch.
        AD4M_REF="pull/$AD4M_PR/head"
        REASON="the description pairs it with $AD4M_REPO#$AD4M_PR"
      fi
      ;;
    '@'*)
      AD4M_REF="${PAIRING#@}"
      REASON="the description pairs it with $AD4M_REPO@$AD4M_REF"
      ;;
  esac
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
