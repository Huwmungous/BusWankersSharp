#!/bin/bash
set -e

# ============================================================================
# deploy-buswankers-backend.sh — UploaderService deployment
# Target: queeg (self-hosted — build machine = target, same as the frontend)
# Usage:  ./deploy-buswankers-backend.sh [--no-pull] [--no-start]
#
# Mirrors the estate's static-template + sed-substitution deploy shape (see
# Infoforum's deploy-rozebowldeploydaemon.sh and BreakTackle's
# deploy-one-bt-service.sh): pull -> stop -> publish -> wipe+copy deploy ->
# install systemd unit from systemd/buswankers-uploader.service.template ->
# start -> health-verify. Companion to ReactApp/deploy-buswankers-frontend.sh,
# which this script's guarded-pull-with-timeout logic is copied from directly.
#
# Wired into RozeBowlDeployDaemon's DEV trunk Steps as "deploy buswankers
# backend" (Infoforum PR #382), piggybacking on queeg's existing
# rozebowl_deploy signal the same way the frontend step already does — see
# that step's "//Why" note in RozeBowlDeployDaemon/appsettings.json. Fully
# independent of that pipeline otherwise: safe to run by hand at any time.
#
# Prerequisites:
#   - .NET 10 SDK on this box (queeg)
#   - This repo cloned to $BW_REPO
#   - NOPASSWD sudo for the invoking user, for the systemctl/mkdir/cp/sed
#     steps below (matches every other estate deploy script's assumption)
# ============================================================================

# ----------------------------
# Configuration
# ----------------------------
BW_REPO="${BW_REPO:-$HOME/repos/BusWankersSharp}"
PROJECT_DIR="$BW_REPO/UploaderService"
SERVER_NAME="UploaderService"
SERVICE_NAME="buswankers-uploader"
DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/BusWankersSharp/WebServices}"
DEPLOY_PATH="$DEPLOY_ROOT/$SERVER_NAME"
SERVICE_PORT=5061
UNIT_FILE="$SERVICE_NAME.service"
# Repo template is named .service.template (not .service), matching the
# Infoforum convention, so an installed unit is never mistaken for the
# repo-tracked source of truth.
UNIT_SRC="$PROJECT_DIR/systemd/$SERVICE_NAME.service.template"
UNIT_DST="/etc/systemd/system/$UNIT_FILE"

# Service account the unit runs as (and owns the deployed files). Defaults to
# the invoking human (hugh) — this is a personal project, not part of the
# IFServices/BTServices managed estates.
SERVICE_USER="${BW_SERVICE_USER:-$USER}"
if [ -n "$SUDO_USER" ] && [ -z "$BW_SERVICE_USER" ]; then
    SERVICE_USER="$SUDO_USER"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || echo "$SERVICE_USER")"

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

for arg in "$@"; do
    case $arg in
        --no-pull)  DO_PULL=false ;;
        --no-start) DO_START=false ;;
        --help|-h)
            echo "Usage: $0 [--no-pull] [--no-start]"
            echo "  --no-pull    Skip git pull (build from current state)"
            echo "  --no-start   Deploy only, don't start the service"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            exit 1
            ;;
    esac
done

echo "========================================"
echo -e "${BLUE}  BusWankersSharp UploaderService Deployment${NC}"
echo "  Target: queeg (self-hosted)"
echo "========================================"
echo "Runs as:       $SERVICE_USER:$SERVICE_GROUP"
echo "Repo:          $BW_REPO"
echo "Project:       $PROJECT_DIR"
echo "Deploy path:   $DEPLOY_PATH"
echo "Service:       $SERVICE_NAME"
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
if [ ! -f "$UNIT_SRC" ]; then
    echo -e "${RED}[ERROR] Unit template not found: $UNIT_SRC${NC}"
    exit 1
fi
if ! command -v dotnet &> /dev/null; then
    echo -e "${RED}[ERROR] .NET SDK not found. Install it first.${NC}"
    exit 1
fi

DOTNET_VERSION=$(dotnet --version 2>/dev/null || echo "unknown")
echo -e "  .NET SDK: ${GREEN}$DOTNET_VERSION${NC}"
echo ""

# ----------------------------
# Phase 1: Git pull
# ----------------------------
# Same guarded-pull-with-timeout logic as ReactApp/deploy-buswankers-frontend.sh
# and the estate's other deploy scripts: a hung pull (a GitHub SSH connection
# that never answers) is worse than a failed one — it parks this script on
# git-upload-pack until RozeBowlDeployDaemon's own 900s ceiling fires, with
# nothing to show for it.
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
# Phase 2: Stop service
# ----------------------------
echo -e "${BLUE}>>> Phase 2: Stop Service${NC}"

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "    Stopping $SERVICE_NAME..."
    sudo systemctl stop "$SERVICE_NAME"
    echo -e "${GREEN}[OK] Service stopped${NC}"
else
    echo -e "${YELLOW}    Service not running${NC}"
fi
echo ""

# ----------------------------
# Phase 3: Build and publish
# ----------------------------
echo -e "${BLUE}>>> Phase 3: Build & Publish${NC}"

cd "$PROJECT_DIR"
CSPROJ="$SERVER_NAME.csproj"
if [ ! -f "$CSPROJ" ]; then
    echo -e "${RED}[ERROR] $CSPROJ not found in $PROJECT_DIR${NC}"
    exit 1
fi

# Clean rebuild — wipe bin/obj/publish first so a changed source file can
# never hide behind a stale incremental cache (the same rationale as
# deploy-one-bt-service.sh's clean rebuild).
echo "    Clean rebuild — removing bin/obj/publish"
rm -rf ./bin ./obj ./publish

echo "    Publishing $SERVER_NAME (Release)..."
dotnet publish "$CSPROJ" --configuration Release --output "./publish" --self-contained false --runtime linux-x64

if [ ! -d "./publish" ]; then
    echo -e "${RED}[ERROR] Build failed — publish directory not created${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] $SERVER_NAME built${NC}"
echo ""

# ----------------------------
# Phase 4: Deploy
# ----------------------------
echo -e "${BLUE}>>> Phase 4: Deploy${NC}"

sudo mkdir -p "$DEPLOY_PATH"

# No .backup.* copies are kept — git is the rollback mechanism, matching the
# estate-wide convention (Infoforum PR #300 / BreakTackle PR #671).
if [ -d "$DEPLOY_PATH" ] && [ "$(ls -A "$DEPLOY_PATH" 2>/dev/null)" ]; then
    echo "    Clearing existing deployment..."
    sudo rm -rf "$DEPLOY_PATH"
    sudo mkdir -p "$DEPLOY_PATH"
fi

echo "    Copying files to $DEPLOY_PATH"
sudo cp -r ./publish/* "$DEPLOY_PATH/"
sudo chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DEPLOY_PATH"

# Run script, handy for a manual ad-hoc start without systemd.
sudo tee "$DEPLOY_PATH/run.sh" > /dev/null << EOF
#!/bin/bash
cd "\$(dirname "\$0")"
exec dotnet $SERVER_NAME.dll "\$@"
EOF
sudo chmod +x "$DEPLOY_PATH/run.sh"

rm -rf ./publish

echo -e "${GREEN}[OK] $SERVER_NAME deployed to $DEPLOY_PATH${NC}"
echo ""

# ----------------------------
# Phase 5: Install systemd unit (from static template + sed substitution)
# ----------------------------
echo -e "${BLUE}>>> Phase 5: Install systemd Unit${NC}"
echo "    Installing $UNIT_FILE from template..."

sudo sed \
    -e "s|^User=.*|User=$SERVICE_USER|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$DEPLOY_PATH|" \
    -e "s|^ExecStart=.*|ExecStart=/usr/bin/dotnet $DEPLOY_PATH/$SERVER_NAME.dll|" \
    "$UNIT_SRC" | sudo tee "$UNIT_DST" > /dev/null

sudo chmod 644 "$UNIT_DST"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" 2>/dev/null || true

echo -e "${GREEN}[OK] $UNIT_FILE installed${NC}"
echo ""

# ----------------------------
# Phase 6: Start and verify
# ----------------------------
if [ "$DO_START" = true ]; then
    echo -e "${BLUE}>>> Phase 6: Start & Verify${NC}"

    echo "    Starting $SERVICE_NAME..."
    if sudo systemctl start "$SERVICE_NAME" 2>/dev/null; then
        sleep 3

        if systemctl is-active --quiet "$SERVICE_NAME"; then
            echo -e "${GREEN}[OK] $SERVICE_NAME is running${NC}"

            echo "    Checking health endpoint on port $SERVICE_PORT..."
            attempt=0
            max_attempts=10
            HEALTH_URL="http://localhost:${SERVICE_PORT}/health"

            while [ $attempt -lt $max_attempts ]; do
                HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")

                if [ "$HTTP_CODE" = "200" ]; then
                    echo -e "${GREEN}[OK] Health check passed (HTTP $HTTP_CODE)${NC}"
                    break
                fi

                attempt=$((attempt + 1))
                if [ $attempt -lt $max_attempts ]; then
                    sleep 2
                fi
            done

            if [ "$HTTP_CODE" != "200" ]; then
                echo -e "${YELLOW}[WARN] Health check returned HTTP $HTTP_CODE - service may still be starting${NC}"
                echo "    Check logs: sudo journalctl -u $SERVICE_NAME -f"
            fi
        else
            echo -e "${RED}[ERROR] $SERVICE_NAME failed to start${NC}"
            echo "Recent logs:"
            sudo journalctl -u "$SERVICE_NAME" -n 20 --no-pager
            exit 1
        fi
    else
        echo -e "${RED}[ERROR] Failed to start $SERVICE_NAME${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}>>> Phase 6: Start (skipped - use: sudo systemctl start $SERVICE_NAME)${NC}"
fi
echo ""

# ----------------------------
# Summary
# ----------------------------
echo "========================================"
echo -e "${GREEN}  Deployment Complete${NC}"
echo "========================================"
echo ""
echo "  Service:     $SERVICE_NAME"
echo "  Runs as:     $SERVICE_USER:$SERVICE_GROUP"
echo "  Deploy path: $DEPLOY_PATH"
echo "  Unit:        $UNIT_DST"
echo "  Port:        $SERVICE_PORT (behind holly's /buswankers-api/ proxy)"
echo ""
echo "  Useful commands:"
echo "    sudo journalctl -u $SERVICE_NAME -f       # Follow logs"
echo "    sudo systemctl restart $SERVICE_NAME       # Restart"
echo "    sudo systemctl status $SERVICE_NAME        # Status"
echo ""
echo "  Health:"
echo "    curl http://localhost:${SERVICE_PORT}/health"
echo ""
