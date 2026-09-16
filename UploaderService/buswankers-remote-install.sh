#!/bin/bash
set -e

# ============================================================================
# buswankers-remote-install.sh — target-side installer for UploaderService
# Runs AS ROOT (via sudo) on the box that actually hosts the service, i.e.
# intelligence.
#
# This is the single source of truth for "what an installed UploaderService
# looks like" - deploy-buswankers-backend.sh calls it two ways, but the
# install logic itself never forks in two:
#   - LOCAL mode  (running directly on the target): invoked as
#       sudo bash buswankers-remote-install.sh <local-stage-dir>
#   - REMOTE mode (queeg building, intelligence running): the caller rsyncs
#     this script + the publish output to the target and runs it there over
#     SSH the same way:
#       sudo bash buswankers-remote-install.sh <remote-stage-dir>
# Mirrors the shape of BreakTackle's bt-remote-install.sh (build-here/
# install-there split) and Infoforum's deploy-ifautofixdaemon.sh (phase
# structure, systemd unit content), scaled down to UploaderService's single
# service instead of a whole stack.
#
# Expects <stage-dir>/publish/ to contain the dotnet publish output.
# ============================================================================

STAGE="${1:?Usage: sudo bash buswankers-remote-install.sh <stage-dir> [--no-start]}"
NO_START=false
[ "${2:-}" = "--no-start" ] && NO_START=true
PUBLISH_SRC="$STAGE/publish"

SERVER_NAME="UploaderService"
SERVICE_NAME="buswankers-uploader"
DEPLOY_ROOT="${BW_DEPLOY_ROOT:-/srv/BusWankersSharp/WebServices}"
DEPLOY_PATH="$DEPLOY_ROOT/$SERVER_NAME"
SERVICE_PORT="${BW_SERVICE_PORT:-5038}"
SERVICE_HEALTH="/Health"

# Dedicated system account for this service, parallel to BreakTackle's
# BTServices / Infoforum's IFServices, but BusWankersSharp-specific since it
# is neither of those estates. Unlike IFServices (a pre-existing shared
# identity this project must not reshape), BusWankersServices belongs solely
# to this one service, so auto-creating it on first install (matching how the
# old dedicated 'ifautofix' account used to be created, before it moved to
# the shared IFServices identity) is safe here.
SERVICE_USER="${BW_SERVICE_USER:-BusWankersServices}"
SERVICE_GROUP="$SERVICE_USER"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] Must be run as root (sudo bash buswankers-remote-install.sh <stage>).${NC}" >&2
    exit 1
fi

if [ ! -d "$PUBLISH_SRC" ]; then
    echo -e "${RED}[ERROR] $PUBLISH_SRC not found - nothing to install.${NC}" >&2
    exit 1
fi

echo "========================================"
echo -e "${BLUE}  UploaderService Install${NC}"
echo "========================================"
echo "  Stage:       $STAGE"
echo "  Deploy path: $DEPLOY_PATH"
echo "  Service:     $SERVICE_NAME"
echo "  Runs as:     $SERVICE_USER"
echo "  Port:        $SERVICE_PORT"
echo ""

# ----------------------------
# Phase 1: Stop service
# ----------------------------
echo -e "${BLUE}>>> Phase 1: Stop Service${NC}"
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "    Stopping $SERVICE_NAME..."
    systemctl stop "$SERVICE_NAME"
    echo -e "${GREEN}[OK] Service stopped${NC}"
else
    echo -e "${YELLOW}    Service not running${NC}"
fi
echo ""

# ----------------------------
# Phase 2: Service account
# ----------------------------
echo -e "${BLUE}>>> Phase 2: Service Account${NC}"
if ! id "$SERVICE_USER" > /dev/null 2>&1; then
    echo "    Creating system account $SERVICE_USER..."
    useradd --system --create-home --home-dir "/home/$SERVICE_USER" \
        --shell /usr/sbin/nologin --comment "BusWankersSharp UploaderService account" \
        "$SERVICE_USER"
    echo -e "${GREEN}[OK] $SERVICE_USER created${NC}"
else
    echo -e "${GREEN}[OK] $SERVICE_USER already exists${NC}"
fi
echo ""

# ----------------------------
# Phase 3: Deploy files
# ----------------------------
echo -e "${BLUE}>>> Phase 3: Deploy${NC}"
mkdir -p "$DEPLOY_PATH"

# No .backup.* copies are kept - git is the rollback mechanism, matching the
# estate-wide convention (Infoforum PR #300 / BreakTackle PR #671).
if [ -d "$DEPLOY_PATH" ] && [ "$(ls -A "$DEPLOY_PATH" 2>/dev/null)" ]; then
    echo "    Clearing existing deployment..."
    rm -rf "$DEPLOY_PATH"
    mkdir -p "$DEPLOY_PATH"
fi

echo "    Copying files to $DEPLOY_PATH"
cp -r "$PUBLISH_SRC"/* "$DEPLOY_PATH/"

# Run script, handy for a manual ad-hoc start without systemd.
tee "$DEPLOY_PATH/run.sh" > /dev/null << EOF
#!/bin/bash
cd "\$(dirname "\$0")"
exec dotnet $SERVER_NAME.dll "\$@"
EOF
chmod +x "$DEPLOY_PATH/run.sh"

chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DEPLOY_PATH"
echo -e "${GREEN}[OK] Files deployed${NC}"
echo ""

# ----------------------------
# Phase 3b: Autofill store
# ----------------------------
# The ingested autofill files (POST /api/autofill/ingest) live here, NOT under
# $DEPLOY_PATH - Phase 3 rm -rf's the deploy path on every release, and the
# whole point of the store is that a freshly uploaded spreadsheet survives the
# next deploy. Must agree with AutofillStore:Directory in appsettings.json.
# Existing files are left exactly as they are; only ownership is (re)asserted
# so the service account can write there after a user/group change.
echo -e "${BLUE}>>> Phase 3b: Autofill Store${NC}"
STORE_DIR="${BW_AUTOFILL_STORE:-/srv/BusWankersSharp/Data/autofill}"
mkdir -p "$STORE_DIR"
chown "$SERVICE_USER:$SERVICE_GROUP" "$STORE_DIR"
chmod u=rwx,g=rx,o= "$STORE_DIR"
# Rename any files still under the pre-2026-09-16 names to the current ones
# (UploadServiceController.DownloadNameFor) so an already-ingested sale keeps
# its data across the rename rather than showing as "(empty)" until the next
# upload. Only renames when the new name doesn't already exist.
while IFS=: read -r OLD NEW; do
    if [ -f "$STORE_DIR/$OLD" ] && [ ! -e "$STORE_DIR/$NEW" ]; then
        mv "$STORE_DIR/$OLD" "$STORE_DIR/$NEW" && echo "    Renamed legacy $OLD -> $NEW"
    fi
done <<'RENAMES'
bw_autofill.csv:coach_autofill.csv
g_autofill.csv:general_autofill.csv
resale_coach_autofill.csv:coach_resale_autofill.csv
resale_general_autofill.csv:general_resale_autofill.csv
RENAMES
STORE_COUNT=$(find "$STORE_DIR" -maxdepth 1 -name '*.csv' 2>/dev/null | wc -l)
echo -e "${GREEN}[OK] $STORE_DIR ready ($STORE_COUNT autofill file(s) present)${NC}"
echo ""

# ----------------------------
# Phase 3c: Firewall - open the service port to holly
# ----------------------------
# holly's nginx proxies /buswankers-api/ to this box on $SERVICE_PORT. Fedora's
# firewalld drops that unless the port is opened to holly explicitly - the
# same per-service rich rule Infoforum's deploy-one-MCPServer.sh provisions
# (PROVISION_PUBLIC_PORT from MCP_PROXY_HOST). Until this existed, holly got a
# 502 on every /buswankers-api/ request (2026-09-15). Idempotent.
echo -e "${BLUE}>>> Phase 3c: Firewall${NC}"
PROXY_HOST="${BW_PROXY_HOST:-192.168.0.252}"
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    FW_RULE="rule family=\"ipv4\" source address=\"$PROXY_HOST/32\" port port=\"$SERVICE_PORT\" protocol=\"tcp\" accept"
    if firewall-cmd --permanent --query-rich-rule="$FW_RULE" >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] firewalld: $SERVICE_PORT/tcp from $PROXY_HOST already open${NC}"
    else
        firewall-cmd --permanent --add-rich-rule="$FW_RULE" >/dev/null
        firewall-cmd --reload >/dev/null
        echo -e "${GREEN}[OK] firewalld: opened $SERVICE_PORT/tcp from $PROXY_HOST${NC}"
    fi
else
    echo -e "${YELLOW}    firewalld not running - nothing to open${NC}"
fi
echo ""

# ----------------------------
# Phase 4: systemd unit
# ----------------------------
echo -e "${BLUE}>>> Phase 4: Configure systemd${NC}"

# Remove any stale drop-ins from an earlier install - systemd merges drop-ins
# on top of the unit below, so a leftover override.conf would silently shadow
# it (same rationale as deploy-ifautofixdaemon.sh's equivalent phase).
if [ -d "/etc/systemd/system/$SERVICE_NAME.service.d" ]; then
    echo "    Removing stale drop-ins under /etc/systemd/system/$SERVICE_NAME.service.d"
    rm -rf "/etc/systemd/system/$SERVICE_NAME.service.d"
fi

# Content here is the authoritative copy - keep in step with the reference
# copy at UploaderService/systemd/buswankers-uploader.service in the repo.
tee "/etc/systemd/system/$SERVICE_NAME.service" > /dev/null << EOF
[Unit]
Description=BusWankersSharp UploaderService (spreadsheet -> autofill generation)
After=network-online.target
Wants=network-online.target
Documentation=https://longmanrd.net/buswankers/

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$DEPLOY_PATH
ExecStart=/usr/bin/dotnet $DEPLOY_PATH/$SERVER_NAME.dll

# Restart configuration
Restart=always
RestartSec=10
KillMode=control-group
KillSignal=SIGTERM
TimeoutStopSec=15

# Environment. NB if-release stamps ASPNETCORE_ENVIRONMENT=Development on
# intelligence (it hosts the DEV estate) and an EnvironmentFile= wins over
# the Environment= line below - so that line is a statement of intent only.
# What actually keeps this service on Production is SharedEstateService in
# Program.cs; if-release is still loaded for IF__Environment / IF__Version.
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=DOTNET_PRINT_TELEMETRY_MESSAGE=false
EnvironmentFile=-/etc/sysconfig/if-secrets
EnvironmentFile=-/etc/sysconfig/if-release

# Security hardening - plain webservice, no shell-outs.
NoNewPrivileges=true
PrivateTmp=true

# Resource limits
LimitNOFILE=65536

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" 2>/dev/null || true
echo -e "${GREEN}[OK] Service configured${NC}"
echo ""

# ----------------------------
# Phase 5: Start and verify
# ----------------------------
if [ "$NO_START" = true ]; then
    echo -e "${YELLOW}>>> Phase 5: Start (skipped - use: sudo systemctl start $SERVICE_NAME)${NC}"
    echo ""
    echo "========================================"
    echo -e "${GREEN}  Install Complete (not started)${NC}"
    echo "========================================"
    exit 0
fi

echo -e "${BLUE}>>> Phase 5: Start & Verify${NC}"
echo "    Starting $SERVICE_NAME..."
if systemctl start "$SERVICE_NAME" 2>/dev/null; then
    sleep 3
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        echo -e "${GREEN}[OK] $SERVICE_NAME is running${NC}"

        HEALTH_URL="http://localhost:${SERVICE_PORT}${SERVICE_HEALTH}"
        echo "    Checking $HEALTH_URL..."
        attempt=0
        max_attempts=15
        HTTP_CODE="000"
        while [ $attempt -lt $max_attempts ]; do
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
            [ "$HTTP_CODE" = "200" ] && break
            attempt=$((attempt + 1))
            [ $attempt -lt $max_attempts ] && sleep 2
        done

        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}[OK] Health check passed (HTTP $HTTP_CODE)${NC}"
        else
            echo -e "${RED}[ERROR] $SERVICE_NAME did not answer $SERVICE_HEALTH on port $SERVICE_PORT (HTTP $HTTP_CODE)${NC}"
            journalctl -u "$SERVICE_NAME" -n 40 --no-pager
            exit 1
        fi
    else
        echo -e "${RED}[ERROR] $SERVICE_NAME failed to start${NC}"
        journalctl -u "$SERVICE_NAME" -n 40 --no-pager
        exit 1
    fi
else
    echo -e "${RED}[ERROR] Failed to start $SERVICE_NAME${NC}"
    journalctl -u "$SERVICE_NAME" -n 40 --no-pager
    exit 1
fi
echo ""

echo "========================================"
echo -e "${GREEN}  Install Complete${NC}"
echo "========================================"
echo "  Service:     $SERVICE_NAME"
echo "  Runs as:     $SERVICE_USER"
echo "  Deploy path: $DEPLOY_PATH"
echo "  Health:      http://localhost:${SERVICE_PORT}${SERVICE_HEALTH}"
echo ""
echo "  Useful commands:"
echo "    sudo journalctl -u $SERVICE_NAME -f       # Follow logs"
echo "    sudo systemctl restart $SERVICE_NAME       # Restart"
echo "    sudo systemctl status $SERVICE_NAME        # Status"
echo ""
echo "  Before this can boot successfully, BUSWANKERS_CLIENTSECRET must be set"
echo "  in /etc/sysconfig/if-secrets, and the 'BusWankers' AppDomain must have"
echo "  a bootstrap record + Keycloak client provisioned in ConfigWebService -"
echo "  see UploaderService/deploy-buswankers-backend.sh's preflight."
echo ""
