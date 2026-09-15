#!/bin/bash
set -e

# ============================================================================
# Bus Wankers Uploader (spreadsheet -> autofill) Backend Deployment
# Build & serve on: queeg (this box IS the target - no remote rsync needed,
#                    unlike deploy-buswankers-frontend.sh which builds on queeg
#                    but serves from holly)
# Usage:            ./deploy-buswankers-uploader.sh [--no-pull]
#
# One-time setup before the first run:
#   sudo mkdir -p /srv/BusWankersSharp/WebServices/UploaderService
#   sudo chown "$USER" /srv/BusWankersSharp/WebServices/UploaderService
#   sudo cp ops/systemd/buswankers-uploader.service /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable buswankers-uploader
# and on holly: copy ops/nginx/buswankers-api.inc into place (see that file's
# own header comment) and reload nginx.
# ============================================================================

BW_REPO="${BW_REPO:-$HOME/repos/BusWankersSharp}"
PROJECT_DIR="$BW_REPO/UploaderService"
DEPLOY_DIR="${DEPLOY_DIR:-/srv/BusWankersSharp/WebServices/UploaderService}"
SERVICE_NAME="${SERVICE_NAME:-buswankers-uploader}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

DO_PULL=true
for arg in "$@"; do
    case $arg in
        --no-pull) DO_PULL=false ;;
        --help|-h)
            echo "Usage: $0 [--no-pull]"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $arg${NC}"
            exit 1
            ;;
    esac
done

echo "========================================"
echo -e "${BLUE}  Bus Wankers Uploader Backend Deployment${NC}"
echo "  Build & serve: $(hostname)"
echo "========================================"
echo "Repo:        $BW_REPO"
echo "Deploy dir:  $DEPLOY_DIR"
echo "Service:     $SERVICE_NAME"
echo ""

if [ ! -d "$BW_REPO" ]; then
    echo -e "${RED}[ERROR] BusWankersSharp repo not found: $BW_REPO${NC}"
    exit 1
fi
if ! command -v dotnet &> /dev/null; then
    echo -e "${RED}[ERROR] dotnet not found. Install the .NET 10 SDK first.${NC}"
    exit 1
fi

if [ "$DO_PULL" = true ]; then
    echo -e "${BLUE}>>> Phase 1: Git Pull${NC}"
    cd "$BW_REPO"
    git pull
    echo -e "${GREEN}[OK] BusWankersSharp updated${NC}"
    echo ""
else
    echo -e "${YELLOW}>>> Phase 1: Git Pull (skipped)${NC}"
    echo ""
fi

echo -e "${BLUE}>>> Phase 2: Publish${NC}"
cd "$PROJECT_DIR"
PUBLISH_DIR=$(mktemp -d)
dotnet publish -c Release -o "$PUBLISH_DIR"
echo -e "${GREEN}[OK] Published to $PUBLISH_DIR${NC}"
echo ""

echo -e "${BLUE}>>> Phase 3: Activate${NC}"
if [ ! -d "$DEPLOY_DIR" ]; then
    echo "    $DEPLOY_DIR doesn't exist yet - creating it (needs sudo once)."
    sudo mkdir -p "$DEPLOY_DIR"
    sudo chown "$USER" "$DEPLOY_DIR"
fi

echo "    Syncing published output into $DEPLOY_DIR ..."
rsync -a --delete "$PUBLISH_DIR"/ "$DEPLOY_DIR"/
rm -rf "$PUBLISH_DIR"

echo "    Restarting $SERVICE_NAME ..."
sudo systemctl restart "$SERVICE_NAME"
sleep 1
sudo systemctl --no-pager --lines=5 status "$SERVICE_NAME" || true

echo -e "${GREEN}[OK] Uploader backend deployed${NC}"
echo ""
echo "========================================"
echo -e "${GREEN}  Deployment Complete${NC}"
echo "========================================"
echo ""
echo "  Quick local check (from queeg itself):"
echo "    curl -s http://localhost:5061/api/autofill/sale-types"
echo ""
echo "  Through holly's proxy (once buswankers-api.inc is in place):"
echo "    curl -s https://longmanrd.net/buswankers-api/api/autofill/sale-types"
echo ""
