#!/usr/bin/env bash
#
# setup-holly-buswankers-links.sh - web-root layout on holly's HDD for the
# Bus Wankers frontend, matching the pattern set up for RozeBowl/Infoforum
# (see Infoforum's ops/deploy/setup-holly-srv-links.sh). Run ONCE on holly
# (Debian/RPi5, aarch64; web user www-data; no SELinux/restorecon), before
# the first deploy-buswankers-frontend.sh run.
#
# Layout this produces (everything physically on the HDD at /mnt/data_disk):
#
#   /srv/BusWankersSharp                    -> /mnt/data_disk/srv/BusWankersSharp
#     Apps/bus-wankers-react/                (deploy target: the CRA build)
#     www/buswankers -> ../Apps/bus-wankers-react   (nginx /buswankers/)
#
# This keeps BusWankersSharp physically alongside the RozeBowl/Infoforum
# trees on the same HDD, but as its own top-level project - it isn't part
# of either of those repos.
#
set -euo pipefail

HDD="/mnt/data_disk"
HDD_SRV="${HDD}/srv"
WEB_USER="www-data"

log()  { printf '==> %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"

log "Triggering automount of ${HDD}..."
probe="${HDD}/.automount-probe.$$"
touch "$probe" 2>/dev/null || die "cannot write to ${HDD} - HDD/automount not available"
[ -f "$probe" ] || die "${HDD} probe vanished - mount misbehaving"
rm -f "$probe"
log "  ${HDD} writable. Device: $(findmnt -no SOURCE,FSTYPE "$HDD" 2>/dev/null | tail -1)"

log "Creating web root under ${HDD_SRV}..."
mkdir -p "${HDD_SRV}/BusWankersSharp/Apps/bus-wankers-react"

link="/srv/BusWankersSharp"
target="${HDD_SRV}/BusWankersSharp"
if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
    log "Top link OK: ${link} -> ${target}"
else
    [ -L "$link" ] && rm -f "$link"
    if [ -e "$link" ]; then
        bak="${link}.pre-srvlinks.$(date +%Y%m%d-%H%M%S)"
        mv "$link" "$bak"; log "Moved existing ${link} -> ${bak}"
    fi
    ln -s "$target" "$link"; log "Linked ${link} -> ${target}"
fi

mkdir -p /srv/BusWankersSharp/www
ln -sfn /srv/BusWankersSharp/Apps/bus-wankers-react /srv/BusWankersSharp/www/buswankers
log "Linked /srv/BusWankersSharp/www/buswankers"

chown -R "${WEB_USER}:${WEB_USER}" "${HDD_SRV}/BusWankersSharp"
log "Ownership set to ${WEB_USER}."

log "Done. Tree:"
ls -la /srv/BusWankersSharp/www/ 2>/dev/null || true

log ""
log "Next: add the include from ops/nginx/buswankers.inc to the"
log "longmanrd.net server block (/etc/nginx/sites-available/longmanrd.net),"
log "then: nginx -t && systemctl reload nginx"
