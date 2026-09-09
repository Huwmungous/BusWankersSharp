#!/bin/bash
set -e

# ============================================================================
# Bus Wankers Frontend Deployment
# Build on:  wherever you run this (needs Node + this repo checked out)
# Serve on:  holly (192.168.0.252, nginx, Debian - static front door)
# Usage:     ./deploy-buswankers-frontend.sh [--no-pull] [--no-build]
#
# Mirrors deploy-breaktackle-frontend.sh from the RozeBowl estate (same
# build-here / rsync-to-holly / remote-activate pattern), trimmed down for a
# standalone static app with no backend, no shared @if/web-common libraries,
# and no per-environment config.js. NB this is Create React App, not Vite -
# the build output directory is "build/", not "dist/".
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
#     www/buswankers symlink) and the nginx include from
#     ops/nginx/buswankers.inc added to the longmanrd.net server block
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
    npm run build
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

# 1. Push the build to a staging dir on holly (as $DEPLOY_USER, no sudo needed).
echo "    Pushing build/ -> $REMOTE:$STAGING ..."
rsync -a --delete -e "ssh -o BatchMode=yes" "build/" "$REMOTE:$STAGING/"

# 2. On holly, sync staging into place with the correct ownership, then
#    reload nginx. Debian: web user is www-data; no SELinux, so no
#    chcon/restorecon needed (that's a Fedora concern elsewhere in the
#    estate). Reads its script from stdin via `bash -s`; DEPLOY_DIR/STAGING
#    are passed as positional args. Requires NOPASSWD sudo on holly.
echo "    Activating on holly (sync -> reload)..."
ssh -o BatchMode=yes "$REMOTE" "sudo bash -s -- '$DEPLOY_DIR' '$STAGING'" << 'REMOTE_EOF'
set -e
DEPLOY_DIR="$1"
STAGING="$2"

mkdir -p "$DEPLOY_DIR"

# No .backup.* copies are kept - git is the rollback mechanism.
rsync -a --delete --chown=www-data:www-data "$STAGING"/ "$DEPLOY_DIR"/
chmod -R u=rwX,go=rX "$DEPLOY_DIR"

rm -rf "$STAGING"

# Reload nginx if present (won't fail the deploy if it isn't installed yet).
if command -v nginx >/dev/null 2>&1 && systemctl is-enabled nginx >/dev/null 2>&1; then
    nginx -t && systemctl reload nginx && echo "    nginx reloaded"
else
    echo "    (nginx not active on holly yet - skipping reload)"
fi
REMOTE_EOF

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
echo "    curl -sI http://$DEPLOY_HOST/buswankers/g_autofill.csv"
echo ""
echo "  Reminder: package.json's \"homepage\" must stay \"/buswankers\" or CRA"
echo "  will emit asset URLs for the wrong path."
echo ""
