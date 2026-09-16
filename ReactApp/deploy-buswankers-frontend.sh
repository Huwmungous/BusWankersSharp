#!/bin/bash
set -e

# ============================================================================
# Bus Wankers Frontend Deployment
# Build on:  wherever you run this (needs Node + this repo checked out)
# Serve on:  holly (192.168.0.252, nginx, Debian - static front door)
# Usage:     ./deploy-buswankers-frontend.sh [--no-pull] [--no-build]
#
# Mirrors deploy-breaktackle-frontend.sh from the RozeBowl estate (same
# build-here / rsync-to-holly / remote-activate pattern), trimmed down: no
# shared @if/web-common libraries and no per-environment config.js (the app
# talks to its backend at the fixed same-origin path /buswankers-api/, which
# buswankers-api.inc proxies to UploaderService on intelligence - that half is
# deployed by UploaderService/deploy-buswankers-backend.sh, not here). NB this
# is Create React App, not Vite - the build output directory is "build/", not
# "dist/".
#
# The autofill files themselves are NOT part of this build - they live in the
# backend's AutofillStore and are served through the API; buswankers.inc
# rewrites /buswankers/<name>_autofill.csv onto it. So a fresh frontend deploy
# never changes which autofill files exist.
#
# Prerequisites:
#   - Node.js, npm and rsync on this box; this repo cloned to $BW_REPO
#   - passwordless ssh <this box> -> holly for $DEPLOY_USER (see RozeBowl
#     estate notes section 6.5 for the pattern; same key works here)
#   - NOPASSWD sudo for $DEPLOY_USER on holly (the remote activate step
#     sudo's; it reads its script from stdin, so it cannot also prompt for
#     a password)
#   - holly web root laid out by ops/deploy/setup-holly-buswankers-links.sh
#     (so $DEPLOY_DIR exists on the HDD and nginx serves it via the
#     www/buswankers symlink)
#
# Phase 3 also ships ops/nginx/buswankers.inc and buswankers-api.inc to holly
# on every run (install + idempotent "include" wiring into the longmanrd.net
# server block) - this used to be a manual one-time copy step, now the repo
# is the source of truth and holly's nginx config stays in sync with it.
# ============================================================================

# ----------------------------
# Configuration
# ----------------------------
BW_REPO="${BW_REPO:-$HOME/repos/BusWankersSharp}"
FRONTEND_DIR="$BW_REPO/ReactApp"

# Remote serving host (holly). Override via env if it ever moves.
DEPLOY_HOST="${DEPLOY_HOST:-192.168.0.252}"
DEPLOY_USER="${DEPLOY_USER:-hugh}"          # holly account (NOT the AD-qualified $USER elsewhere)
DEPLOY_DIR="${DEPLOY_DIR:-/srv/BusWankersSharp/Apps/bus-wankers-react}"   # path ON holly
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ----------------------------
# Parse arguments
# ----------------------------
DO_PULL=true
DO_BUILD=true

for arg in "$@"; do
    case $arg in
        --no-pull)  DO_PULL=false ;;
        --no-build) DO_BUILD=false ;;
        --help|-h)
            echo "Usage: $0 [--no-pull] [--no-build]"
            echo "  --no-pull    Skip git pull (build from current state)"
            echo "  --no-build   Skip build, deploy the existing build/ as-is"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            exit 1
            ;;
    esac
done

echo "========================================"
echo -e "${BLUE}  Bus Wankers Frontend Deployment${NC}"
echo "  Build: $(hostname)  ->  Serve: holly ($DEPLOY_HOST)"
echo "========================================"
echo "Repo:          $BW_REPO"
echo "Remote target: $REMOTE:$DEPLOY_DIR"
echo ""

# ----------------------------
# Sanity checks
# ----------------------------
if [ ! -d "$BW_REPO" ]; then
    echo -e "${RED}[ERROR] BusWankersSharp repo not found: $BW_REPO${NC}"
    exit 1
fi
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js not found. Install it first.${NC}"
    exit 1
fi
if ! command -v npm &> /dev/null; then
    echo -e "${RED}[ERROR] npm not found. Install it first.${NC}"
    exit 1
fi
if ! command -v rsync &> /dev/null; then
    echo -e "${RED}[ERROR] rsync not found on this box. Install it first.${NC}"
    exit 1
fi

# Fail fast if holly is unreachable BEFORE spending time on a build.
echo "    Checking ssh to $REMOTE ..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" true 2>/dev/null; then
    echo -e "${RED}[ERROR] Cannot ssh to $REMOTE non-interactively.${NC}"
    echo "        Set up a key (ssh-copy-id $REMOTE) and confirm: ssh $REMOTE true"
    exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
NPM_VERSION=$(npm --version 2>/dev/null || echo "unknown")
echo -e "  Node: ${GREEN}$NODE_VERSION${NC}  npm: ${GREEN}$NPM_VERSION${NC}  remote: ${GREEN}$REMOTE${NC}"
echo ""

# ----------------------------
# Phase 1: Git pull
# ----------------------------
GIT_PULL_TIMEOUT="${DEPLOY_GIT_PULL_TIMEOUT:-120}"
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3}"

guarded_pull() {   # label
    local label="$1"
    local rc=0
    timeout --signal=TERM --kill-after=10 "$GIT_PULL_TIMEOUT" git pull || rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
        echo -e "${RED}[ERROR] git pull ($label) TIMED OUT after ${GIT_PULL_TIMEOUT}s${NC}" >&2
        echo    "    The remote never answered. Check GitHub reachability from this host:" >&2
        echo    "        ssh -o BatchMode=yes -T git@github.com" >&2
    else
        echo -e "${RED}[ERROR] git pull ($label) failed (rc=$rc)${NC}" >&2
    fi
    return 1
}

if [ "$DO_PULL" = true ]; then
    echo -e "${BLUE}>>> Phase 1: Git Pull${NC}"
    cd "$BW_REPO"
    guarded_pull "BusWankersSharp" || exit 1
    echo -e "${GREEN}[OK] BusWankersSharp updated${NC}"
    echo ""
else
    echo -e "${YELLOW}>>> Phase 1: Git Pull (skipped)${NC}"
    echo ""
fi

# ----------------------------
# Phase 2: Build frontend
# ----------------------------
cd "$FRONTEND_DIR"

if [ "$DO_BUILD" = true ]; then
    echo -e "${BLUE}>>> Phase 2: Build Bus Wankers Frontend${NC}"
    echo "    Installing deps and building (CRA -> build/)..."
    npm install
    # DISABLE_ESLINT_PLUGIN=true: eslint-config-react-app 7.0.1 (bundled with
    # react-scripts 5.0.1) is incompatible with eslint 8.57.1's config schema
    # ("Environment key \"jest/globals\" is unknown") - this skips CRA's
    # eslint-loader integration so the build doesn't fail on it. The warnings
    # you see from `npx eslint` directly are unaffected/still useful.
    DISABLE_ESLINT_PLUGIN=true npm run build
    echo -e "${GREEN}[OK] Frontend built${NC}"
else
    echo -e "${YELLOW}>>> Phase 2: Build (skipped) - deploying existing build/${NC}"
fi

if [ ! -d "build" ]; then
    echo -e "${RED}[ERROR] No build directory to deploy (CRA outputs to build/, not dist/)${NC}"
    exit 1
fi
echo ""

# ----------------------------
# Phase 3: Deploy to holly (remote)
# ----------------------------
echo -e "${BLUE}>>> Phase 3: Deploy to $REMOTE${NC}"

STAGING="/tmp/bw-frontend-deploy.$$"
NGINX_STAGING="/tmp/bw-frontend-nginx.$$"

# 1. Push the build to a staging dir on holly (as $DEPLOY_USER, no sudo needed).
echo "    Pushing build/ -> $REMOTE:$STAGING ..."
rsync -a --delete -e "ssh -o BatchMode=yes" "build/" "$REMOTE:$STAGING/"

# 1b. Push the nginx include files too. deploy-buswankers-backend.sh never
#     touches holly (it only ships to intelligence), so this script - already
#     SSHing into holly and reloading nginx for the static build - is the
#     natural place to keep ops/nginx/*.inc in sync there too, instead of
#     relying on someone remembering a manual one-time copy.
echo "    Pushing nginx includes -> $REMOTE:$NGINX_STAGING ..."
ssh -o BatchMode=yes "$REMOTE" "mkdir -p '$NGINX_STAGING'"
rsync -a -e "ssh -o BatchMode=yes" \
    "$BW_REPO/ops/nginx/buswankers.inc" "$BW_REPO/ops/nginx/buswankers-api.inc" \
    "$REMOTE:$NGINX_STAGING/"

# 2. On holly, sync staging into place with the correct ownership, install/
#    wire up the nginx includes, then reload nginx. Debian: web user is
#    www-data; no SELinux, so no chcon/restorecon needed (that's a Fedora
#    concern elsewhere in the estate). Reads its script from stdin via
#    `bash -s`; DEPLOY_DIR/STAGING/NGINX_STAGING are passed as positional
#    args. Requires NOPASSWD sudo on holly.
echo "    Activating on holly (sync -> reload)..."
ssh -o BatchMode=yes "$REMOTE" "sudo bash -s -- '$DEPLOY_DIR' '$STAGING' '$NGINX_STAGING'" << 'REMOTE_EOF'
set -e
DEPLOY_DIR="$1"
STAGING="$2"
NGINX_STAGING="$3"

mkdir -p "$DEPLOY_DIR"

# No .backup.* copies are kept - git is the rollback mechanism.
rsync -a --delete --chown=www-data:www-data "$STAGING"/ "$DEPLOY_DIR"/
chmod -R u=rwX,go=rX "$DEPLOY_DIR"

rm -rf "$STAGING"

# Install the nginx include files and wire them into the longmanrd.net
# server block if not already present there, idempotently - this used to be
# a manual one-time copy step per the .inc files' own header comments; every
# deploy now keeps holly's nginx config in sync with the repo instead.
#
# This phase is FATAL on any problem. An earlier version only warned when it
# couldn't find an anchor line to hook the includes onto, then exited 0 -
# so the deploy daemon reported "Deploy step OK" while every request to
# /buswankers-api/ was a bare nginx 404 (the upload bar's "Request failed
# (404)"). A frontend whose API isn't reachable is not a successful deploy.
#
# Wiring strategy: find whichever file under /etc/nginx holds the
# `server_name ... longmanrd.net ...;` directive (on holly it's
# /etc/nginx/conf.d/longmanrd.conf, not sites-available - layouts vary), then
# pick the server BLOCK in it that has both that server_name and a
# `listen ... 443` - the HTTPS block the browser actually hits. The first
# server_name match in the file is the port-80 -> https redirect block, and
# an include wired there is dead (that's exactly what happened on
# 2026-09-15: "Wired ... nginx reloaded" followed by a 404).
#
# Any earlier buswankers include lines, wherever they landed, are removed
# first and re-inserted in the right block, so this is idempotent and
# self-correcting.
#
# buswankers-api.inc (the /buswankers-api/ proxy AND the
# /buswankers/*_autofill.csv rewrite) is always wired. buswankers.inc (the
# static /buswankers/ location) is wired only if the HTTPS block doesn't
# already declare `location /buswankers/` inline - nginx refuses a duplicate
# location, and holly's longmanrd.conf has it inline.
if [ ! -d /etc/nginx/conf.d ]; then
    echo "    [ERROR] /etc/nginx/conf.d not found - is nginx installed on holly?" >&2
    exit 1
fi

SITE_CONF="$(grep -lE '^[[:space:]]*server_name[[:space:]][^;]*longmanrd\.net' \
    /etc/nginx/sites-available/* /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf /etc/nginx/nginx.conf 2>/dev/null \
    | head -n 1 || true)"
if [ -z "$SITE_CONF" ]; then
    echo "    [ERROR] No nginx config under /etc/nginx declares 'server_name ... longmanrd.net' - cannot wire the includes." >&2
    exit 1
fi
echo "    longmanrd.net config: $SITE_CONF"

SITE_BACKUP="$(mktemp /tmp/longmanrd.net.nginx.XXXXXX)"
cp -p "$SITE_CONF" "$SITE_BACKUP"

for INC in buswankers.inc buswankers-api.inc; do
    install -m 0644 "$NGINX_STAGING/$INC" "/etc/nginx/conf.d/$INC"
done
rm -rf "$NGINX_STAGING"

# 1. Drop any existing buswankers include lines (wherever a previous run put them).
sed -i -E '/^[[:space:]]*include[[:space:]]+\/etc\/nginx\/conf\.d\/buswankers(-api)?\.inc;[[:space:]]*$/d' "$SITE_CONF"

# 2. Locate the HTTPS server block: prints "server_name-line block-start block-end".
#    Comments are stripped before brace counting so a { in a comment can't
#    unbalance it.
BLOCK="$(awk '
  BEGIN { depth=0; inserver=0; name=0; l443=0; start=0 }
  {
    line=$0
    sub(/#.*$/, "", line)
    if (depth==0 && line ~ /^[ \t]*server[ \t]*\{/) { inserver=1; name=0; l443=0; start=NR }
    if (inserver) {
      if (line ~ /^[ \t]*listen[ \t].*443/) l443=1
      if (name==0 && line ~ /^[ \t]*server_name[ \t][^;]*longmanrd\.net/) name=NR
    }
    n=gsub(/\{/,"{",line); m=gsub(/\}/,"}",line); depth+=n-m
    if (inserver && depth==0) { if (l443 && name) { print name, start, NR; exit } inserver=0 }
  }' "$SITE_CONF")"
if [ -z "$BLOCK" ]; then
    echo "    [ERROR] $SITE_CONF has no server block with both 'listen ... 443' and 'server_name ... longmanrd.net' - cannot wire the includes." >&2
    cp -p "$SITE_BACKUP" "$SITE_CONF"
    exit 1
fi
set -- $BLOCK
NAME_LINE="$1"; BLOCK_START="$2"; BLOCK_END="$3"
echo "    HTTPS server block: lines $BLOCK_START-$BLOCK_END (server_name at $NAME_LINE)"

# 3. Insert after the server_name line of THAT block.
sed -i "${NAME_LINE}a\\    include /etc/nginx/conf.d/buswankers-api.inc;" "$SITE_CONF"
echo "    Wired 'include buswankers-api.inc;'"
if sed -n "${BLOCK_START},${BLOCK_END}p" "$SITE_CONF" | grep -qE '^[[:space:]]*location[[:space:]]+/buswankers/[[:space:]]*\{'; then
    echo "    'location /buswankers/' is declared inline in the HTTPS block - leaving it; buswankers.inc installed but not included"
else
    sed -i "${NAME_LINE}a\\    include /etc/nginx/conf.d/buswankers.inc;" "$SITE_CONF"
    echo "    Wired 'include buswankers.inc;'"
fi

# Validate and reload. A failed nginx -t restores the previous site config
# (the .inc files stay installed - they're inert until included) and fails
# the deploy, so a broken include can never be silently left in place.
if ! command -v nginx >/dev/null 2>&1; then
    echo "    [ERROR] nginx binary not found on holly" >&2
    exit 1
fi
if ! nginx -t; then
    echo "    [ERROR] nginx -t failed after wiring the BusWankers includes - restoring $SITE_CONF" >&2
    cp -p "$SITE_BACKUP" "$SITE_CONF"
    nginx -t || true
    exit 1
fi
rm -f "$SITE_BACKUP"
systemctl reload nginx && echo "    nginx reloaded"
REMOTE_EOF

# ----------------------------
# Phase 4: Verify the API is reachable through holly
# ----------------------------
# The whole point of the nginx wiring above is that the page's fetch() calls
# to /buswankers-api/ land on UploaderService. Prove it from outside - the
# same path a browser takes - rather than trusting the reload. /Health is
# unauthenticated and needs no store contents, so it's the right probe; a
# 502 here means nginx is wired but intelligence:5038 isn't answering (check
# buswankers-uploader there), a 404 means the include still isn't active.
echo -e "${BLUE}>>> Phase 4: Verify API through holly${NC}"
VERIFY_URL="${BW_VERIFY_URL:-https://longmanrd.net/buswankers-api/Health}"
HCODE="000"
for attempt in 1 2 3 4 5; do
    HCODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$VERIFY_URL" 2>/dev/null || echo "000")
    [ "$HCODE" = "200" ] && break
    sleep 2
done
if [ "$HCODE" = "200" ]; then
    echo -e "${GREEN}[OK] $VERIFY_URL -> 200${NC}"
else
    echo -e "${RED}[ERROR] $VERIFY_URL -> HTTP $HCODE - the API is not reachable through holly's nginx.${NC}" >&2
    exit 1
fi
echo ""

echo -e "${GREEN}[OK] Frontend deployed to holly${NC}"
echo ""

# ----------------------------
# Summary
# ----------------------------
echo "========================================"
echo -e "${GREEN}  Deployment Complete${NC}"
echo "========================================"
echo ""
echo "  Built on:    $(hostname)"
echo "  Deployed to: $REMOTE:$DEPLOY_DIR"
echo "  Served at:   https://longmanrd.net/buswankers/"
echo ""
echo "  Quick check (from the LAN):"
echo "    curl -sI http://$DEPLOY_HOST/buswankers/"
echo "    curl -s  https://longmanrd.net/buswankers-api/api/autofill/files      # what's in the store"
echo "    curl -sI https://longmanrd.net/buswankers/general_autofill.csv        # proxied to the API; 404 until ingested"
echo ""
echo "  Reminder: package.json's \"homepage\" must stay \"/buswankers\" or CRA"
echo "  will emit asset URLs for the wrong path."
echo ""
