#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# The web app's build, run by .github/workflows/web-deploy.yaml. Every build installs the
# @coasys/ad4m and @coasys/connect this branch pins, builds WE, and says which ad4m that was.
#
# Inputs, from the workflow's environment:
#   COASYS_ENV   `production` or `staging`: which apps/we-web/config/<env>.json the build compiles in,
#                and whether it carries the developer features (staging does, production does not).
#   WE_BRANCH    the branch or tag built, for /build-info.json.
#   WE_COMMIT    the commit built, for /build-info.json.
#
# There is no special case for a pull request: one that needs an unmerged ad4m change pins that
# ad4m pull request's snapshot (`pnpm bump:ad4m #<N>`), which installs from the lockfile like any
# other pin and is the same build CI tests. See docs/contributing/ad4m-and-deploys.md.
# ---------------------------------------------------------------------------
set -euo pipefail

echo "── Environment"
echo "  node: $(node --version)"
echo "  npm:  $(npm --version)"
echo "  pnpm: $(pnpm --version 2>/dev/null || echo 'not found')"
echo "  git:  $(git --version)"
echo "  pwd:  $PWD"

DIST="$PWD/apps/we-web/dist"

case "${COASYS_ENV:-}" in
  production | staging) ;;
  *) echo "COASYS_ENV must be production or staging, got '${COASYS_ENV:-}'" >&2; exit 1 ;;
esac
export COASYS_ENV
WE_BRANCH="${WE_BRANCH:-}"
WE_VERSION="$(node -p "require('./package.json').version")"

# Which ad4m, read the way every workflow reads it. A pin it cannot read fails the build
# rather than producing a page nobody can say anything about.
PIN="$(node scripts/ad4m-pin.mjs)"
AD4M_PIN_KIND="$(printf '%s\n' "$PIN" | sed -n 's/^kind=//p')"
AD4M_PIN_VERSION="$(printf '%s\n' "$PIN" | sed -n 's/^version=//p')"
AD4M_SHA="$(node scripts/ad4m-pin.mjs --commit 2>/dev/null || true)"
echo "── ad4m: $AD4M_PIN_KIND ${AD4M_PIN_VERSION:-${AD4M_SHA:0:9}}"

# Developer features (the showcase templates, pretend people, Settings → Developer) for staging,
# where work in progress is looked at. Production is a tagged release and gets none of them. See
# packages/module-system/shared/src/devFeatures.ts.
if [ "$COASYS_ENV" = staging ]; then export WE_DEV_FEATURES=true; else export WE_DEV_FEATURES=false; fi
echo "── developer features: $WE_DEV_FEATURES (env: $COASYS_ENV)"

NODE_OPTIONS='--max-old-space-size=8192' pnpm build

# --- Say what this build is -------------------------------------------------
#
# A page built from "ad4m at the time" is otherwise unexplainable a week later, and a
# tester hitting RPC failures has no way to tell a WE bug from an SDK the executor in
# front of them does not match. Both halves are written: /build-info.json for anything
# that wants to read it, and a console line for the person who has the page open.

export DIST AD4M_PIN_KIND AD4M_PIN_VERSION AD4M_SHA WE_BRANCH WE_COMMIT WE_VERSION

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
    ad4mPin: process.env.AD4M_PIN_KIND,
    ad4mVersion: process.env.AD4M_PIN_VERSION || null,
    ad4mSha: process.env.AD4M_SHA || null,
    weBranch: process.env.WE_BRANCH || null,
    weCommit: process.env.WE_COMMIT || null,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dist, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

  const sha = (info.ad4mSha || '').slice(0, 9);
  const summary =
    info.ad4mPin === 'snapshot'
      ? \`WE \${info.weVersion}, with the @coasys/ad4m snapshot of coasys/ad4m@\${sha}\`
      : \`WE \${info.weVersion}, with @coasys/ad4m \${info.ad4mVersion}\${sha ? \` (coasys/ad4m@\${sha})\` : ''}\`;

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
