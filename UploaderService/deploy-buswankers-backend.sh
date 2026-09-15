#!/bin/bash
set -e

# ============================================================================
# deploy-buswankers-backend.sh — UploaderService deployment
# Target: intelligence. BUILD happens on this box (normally queeg, matching
# the deployment daemon's own host), artefacts are rsync'd to intelligence,
# and a single privileged installer (buswankers-remote-install.sh) runs there
# over SSH. A target equal to the box this script is running ON collapses to
# a local install instead (no SSH hop) - the same "Does The Right Thing"
# behaviour BreakTackle's deploy-all-bt-services.sh uses, so running this
# directly ON intelligence just installs locally.
# Usage:  ./deploy-buswankers-backend.sh [--target HOST] [--no-pull] [--no-start]
#
# ── Why intelligence, not queeg ─────────────────────────────────────────────
# The deployment daemon (RozeBowlDeployDaemon) runs on queeg, but queeg is a
# build/orchestration host, not where estate backend services actually run:
# frontends deploy queeg -> holly, backends deploy queeg -> intelligence,
# matching BreakTackle's own trio (BreakTackleAPI/JibberJabber/SvgApi) and
# RozeBowlBotRunner. UploaderService is a backend service, so it follows that
# same pattern now instead of self-hosting on queeg (its original shape).
#
# ── What changed from the old self-hosted-on-queeg script ──────────────────
# UploaderService also now bootstraps through IFGlobal's ServiceFactory
# (Program.cs) rather than a bare WebApplication.CreateBuilder(): it takes its
# listen port from IFGlobal.PortResolver (5038, see PortResolver.cs), ships
# its logs via IFLogger, and authenticates against ConfigWebService/Keycloak
# under its own "BusWankers" AppDomain (see appsettings.json's "IF" section).
# That bootstrap needs infrastructure this script cannot provision itself -
# see the Phase 0 preflight below.
#
# Companion to ReactApp/deploy-buswankers-frontend.sh (queeg -> holly), and
# wired into RozeBowlDeployDaemon's DEV trunk Steps as "deploy buswankers
# backend" (Infoforum PR #382). Fully independent of that pipeline otherwise:
# safe to run by hand at any time.
#
# Prerequisites:
#   - .NET 10 SDK on this box (for the build)
#   - This repo cloned to $BW_REPO, and Infoforum cloned as a sibling at
#     $IF_REPO (both needed to build - IFGlobal is a ProjectReference, not a
#     package yet)
#   - key-based SSH from this box to TARGET_USER@intelligence (no password
#     prompt), and that user able to sudo on intelligence without an
#     interactive password - only needed in REMOTE mode (this box != target)
#   - BUSWANKERS_CLIENTSECRET set in intelligence's /etc/sysconfig/if-secrets,
#     and a "BusWankers" AppDomain bootstrap record + Keycloak client
#     provisioned in ConfigWebService (same shape as the RozeBowl/BreakTackle
#     AppDomains) - see the Phase 0 preflight; this script cannot provision
#     either and will refuse to deploy a service that can only crash-loop
#     without them.
# ============================================================================

# ----------------------------
# Configuration
# ----------------------------
BW_REPO="${BW_REPO:-$HOME/repos/BusWankersSharp}"
PROJECT_DIR="$BW_REPO/UploaderService"
IF_REPO="${IF_REPO:-$HOME/repos/Infoforum}"
SERVER_NAME="UploaderService"
SERVICE_NAME="buswankers-uploader"
SERVICE_PORT=5038
SERVICE_HEALTH="/Health"
CONFIG_SERVICE_URL="${BW_CONFIG_SERVICE_URL:-https://longmanrd.net/config}"
APP_DOMAIN="BusWankers"

TARGET_HOST="${REMOTE_HOST:-intelligence}"
# NOT $USER: this script runs on queeg, where the login is the AD-qualified
# "hugh@longmanrd.infoforum.co.uk" account. The other Fedora boxes
# (intelligence, holly, gambit) only know the plain local account "hugh" -
# same reason ReactApp/deploy-buswankers-frontend.sh hardcodes DEPLOY_USER
# instead of using $USER.
TARGET_USER="${REMOTE_USER:-hugh}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ----------------------------
# Parse arguments
# ----------------------------
DO_PULL=true
DO_START=true

while [ $# -gt 0 ]; do
    case "$1" in
        --target)    TARGET_HOST="$2"; shift 2 ;;
        --target-user) TARGET_USER="$2"; shift 2 ;;
        --no-pull)   DO_PULL=false; shift ;;
        --no-start)  DO_START=false; shift ;;
        --help|-h)
            echo "Usage: $0 [--target HOST] [--target-user USER] [--no-pull] [--no-start]"
            echo "  --target HOST      Box to deploy to. DEFAULT: intelligence."
            echo "  --target-user USER SSH/sudo user on the target. DEFAULT: hugh."
            echo "  --no-pull          Skip git pull (build from current state)"
            echo "  --no-start         Deploy only, don't start the service"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            exit 1
            ;;
    esac
done

# A target equal to this box (by hostname, short hostname, or localhost)
# collapses to a local install - no SSH hop needed.
THIS_HOST="$(hostname -f 2>/dev/null || hostname)"
THIS_SHORT="$(hostname -s 2>/dev/null || hostname)"
REMOTE=true
case "$TARGET_HOST" in
    localhost|127.0.0.1|"$THIS_HOST"|"$THIS_SHORT") REMOTE=false ;;
esac

echo "========================================"
echo -e "${BLUE}  BusWankersSharp UploaderService Deployment${NC}"
if [ "$REMOTE" = true ]; then
    echo "  Mode:   REMOTE - build here, install on $TARGET_HOST over SSH"
else
    echo "  Mode:   LOCAL - build and install on this box ($TARGET_HOST)"
fi
echo "========================================"
echo "Repo:          $BW_REPO"
echo "Infoforum repo:$IF_REPO"
echo "Project:       $PROJECT_DIR"
echo "Service:       $SERVICE_NAME"
echo "Port:          $SERVICE_PORT"
echo ""

# ----------------------------
# Sanity checks
# ----------------------------
if [ ! -d "$BW_REPO" ]; then
    echo -e "${RED}[ERROR] BusWankersSharp repo not found: $BW_REPO${NC}"
    exit 1
fi
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}[ERROR] Project directory not found: $PROJECT_DIR${NC}"
    exit 1
fi
if [ ! -d "$IF_REPO/csharp/IFGlobal" ]; then
    echo -e "${RED}[ERROR] Infoforum repo (for IFGlobal) not found: $IF_REPO${NC}"
    echo "    Clone it as a sibling of BusWankersSharp:"
    echo "        git clone <infoforum-repo-url> $IF_REPO"
    exit 1
fi
if ! command -v dotnet &> /dev/null; then
    echo -e "${RED}[ERROR] .NET SDK not found. Install it first.${NC}"
    exit 1
fi
INSTALLER_SRC="$PROJECT_DIR/buswankers-remote-install.sh"
if [ ! -f "$INSTALLER_SRC" ]; then
    echo -e "${RED}[ERROR] buswankers-remote-install.sh not found next to this script.${NC}"
    exit 1
fi

DOTNET_VERSION=$(dotnet --version 2>/dev/null || echo "unknown")
echo -e "  .NET SDK: ${GREEN}$DOTNET_VERSION${NC}"
echo ""

# ----------------------------
# Phase 0: Bootstrap preflight
# ----------------------------
# UploaderService now bootstraps through ServiceFactory, which means it can
# only start if ConfigWebService already has a bootstrap record (and Keycloak
# a client) for the "BusWankers" AppDomain - the same shape RozeBowl and
# BreakTackle each have their own of. This script has no access to Keycloak
# admin or ConfigWebService's database, so it can't provision that itself;
# it can only check whether someone already has, and refuse to ship a build
# that will only crash-loop if not.
echo -e "${BLUE}>>> Phase 0: Bootstrap Preflight${NC}"
CCODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
    "${CONFIG_SERVICE_URL}/Config?cfg=bootstrap&type=service&appDomain=${APP_DOMAIN}&app=deploy-script" 2>/dev/null || echo "000")
if [ "$CCODE" = "200" ]; then
    echo -e "${GREEN}[OK] ConfigWebService has a bootstrap record for AppDomain '$APP_DOMAIN'${NC}"
else
    echo -e "${RED}[ERROR] ConfigWebService did not return a bootstrap record for AppDomain '$APP_DOMAIN' (HTTP $CCODE).${NC}"
    echo "    Before this can deploy, someone with ConfigWebService/Keycloak admin access needs to:"
    echo "      1. Create a Keycloak client for the '$APP_DOMAIN' AppDomain (mirroring the"
    echo "         existing RozeBowl/BreakTackle clients) and set its secret as"
    echo "         BUSWANKERS_CLIENTSECRET in intelligence's /etc/sysconfig/if-secrets."
    echo "      2. Add a bootstrap record for '$APP_DOMAIN' to ConfigWebService."
    echo "    Refusing to deploy a build that can only crash-loop without these."
    exit 1
fi
echo ""

# ----------------------------
# Phase 1: Git pull
# ----------------------------
GIT_PULL_TIMEOUT="${DEPLOY_GIT_PULL_TIMEOUT:-120}"
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3}"

guarded_pull() {   # label, repo dir
    local label="$1" dir="$2" rc=0
    ( cd "$dir" && timeout --signal=TERM --kill-after=10 "$GIT_PULL_TIMEOUT" git pull ) || rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
        echo -e "${RED}[ERROR] git pull ($label) TIMED OUT after ${GIT_PULL_TIMEOUT}s${NC}" >&2
    else
        echo -e "${RED}[ERROR] git pull ($label) failed (rc=$rc)${NC}" >&2
    fi
    return 1
}

if [ "$DO_PULL" = true ]; then
    echo -e "${BLUE}>>> Phase 1: Git Pull${NC}"
    guarded_pull "BusWankersSharp" "$BW_REPO" || exit 1
    guarded_pull "Infoforum" "$IF_REPO" || exit 1
    echo -e "${GREEN}[OK] Repos updated${NC}"
    echo ""
else
    echo -e "${YELLOW}>>> Phase 1: Git Pull (skipped)${NC}"
    echo ""
fi

# ----------------------------
# Phase 2: Build
# ----------------------------
echo -e "${BLUE}>>> Phase 2: Build & Publish${NC}"
cd "$PROJECT_DIR"
CSPROJ="$SERVER_NAME.csproj"
if [ ! -f "$CSPROJ" ]; then
    echo -e "${RED}[ERROR] $CSPROJ not found in $PROJECT_DIR${NC}"
    exit 1
fi

STAGE="$(mktemp -d /tmp/buswankers-deploy-stage.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

# Clean rebuild - wipe bin/obj/publish first so a changed source file can
# never hide behind a stale incremental cache.
echo "    Clean rebuild - removing bin/obj"
rm -rf ./bin ./obj

echo "    Publishing $SERVER_NAME (Release)..."
dotnet publish "$CSPROJ" --configuration Release --output "$STAGE/publish" \
    --self-contained false --runtime linux-x64

if [ ! -d "$STAGE/publish" ]; then
    echo -e "${RED}[ERROR] Build failed - publish directory not created${NC}"
    exit 1
fi
cp "$INSTALLER_SRC" "$STAGE/buswankers-remote-install.sh"

echo -e "${GREEN}[OK] $SERVER_NAME built${NC}"
echo ""

# ----------------------------
# Phase 3: Install
# ----------------------------
if [ "$REMOTE" = true ]; then
    echo -e "${BLUE}>>> Phase 3: Ship & Install on $TARGET_HOST${NC}"

    SSH_BASE=(ssh "${SSH_OPTS[@]}" "$TARGET_USER@$TARGET_HOST")
    if ! "${SSH_BASE[@]}" true 2>/dev/null; then
        echo -e "${RED}[ERROR] Cannot reach $TARGET_USER@$TARGET_HOST over key-based SSH.${NC}"
        echo "    Set up passwordless SSH (and passwordless sudo on the target) first,"
        echo "    or override with --target-user."
        exit 1
    fi

    REMOTE_STAGE="/tmp/buswankers-deploy.$(date +%s).$$"
    "${SSH_BASE[@]}" "mkdir -p $REMOTE_STAGE"

    echo "    Shipping artefacts to $TARGET_HOST:$REMOTE_STAGE..."
    if ! rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$STAGE/" "$TARGET_USER@$TARGET_HOST:$REMOTE_STAGE/"; then
        echo -e "${RED}[ERROR] Failed to ship artefacts to $TARGET_HOST.${NC}"
        "${SSH_BASE[@]}" "rm -rf $REMOTE_STAGE" 2>/dev/null || true
        exit 1
    fi

    echo "    Running installer on $TARGET_HOST..."
    INSTALL_ARGS="$REMOTE_STAGE"
    [ "$DO_START" = false ] && INSTALL_ARGS="$REMOTE_STAGE --no-start"
    INSTALL_RC=0
    "${SSH_BASE[@]}" "sudo bash $REMOTE_STAGE/buswankers-remote-install.sh $INSTALL_ARGS" || INSTALL_RC=$?
    "${SSH_BASE[@]}" "rm -rf $REMOTE_STAGE" 2>/dev/null || true

    if [ "$INSTALL_RC" -ne 0 ]; then
        echo -e "${RED}[ERROR] Remote install failed (rc=$INSTALL_RC).${NC}"
        exit "$INSTALL_RC"
    fi
else
    echo -e "${BLUE}>>> Phase 3: Install locally${NC}"
    if [ "$DO_START" = false ]; then
        sudo bash "$STAGE/buswankers-remote-install.sh" "$STAGE" --no-start
    else
        sudo bash "$STAGE/buswankers-remote-install.sh" "$STAGE"
    fi
fi

echo ""
echo "========================================"
echo -e "${GREEN}  Deployment Complete${NC}"
echo "========================================"
echo "  Target:  $([ "$REMOTE" = true ] && echo "$TARGET_USER@$TARGET_HOST" || echo "$TARGET_HOST (local)")"
echo "  Service: $SERVICE_NAME"
echo "  Health:  http://localhost:${SERVICE_PORT}${SERVICE_HEALTH}  (on $TARGET_HOST)"
echo ""
