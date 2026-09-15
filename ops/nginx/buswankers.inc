# nginx location block for the Bus Wankers frontend (static React SPA).
#
# Matches the include-file pattern used for the other longmanrd.net services
# (see Infoforum's IF.WebServices/Deployment/nginx/*.inc) and the exact
# alias/try_files shape already used for RozeBowl's sibling static app
# (Frontend/rozebowl-bot-dashboard's /rozebowl/bots/ block).
#
# Installed to holly at /etc/nginx/conf.d/buswankers.inc by
# ReactApp/deploy-buswankers-frontend.sh on every run, and wired into the
# longmanrd.net HTTPS server block by the same script UNLESS that block already
# declares `location /buswankers/` inline (holly's longmanrd.conf did, as of
# 2026-09-15) - nginx refuses a duplicate location, so in that case the inline
# block stays authoritative and this file is installed but not included. Run
# ops/deploy/setup-holly-buswankers-links.sh once first so the alias target
# below exists.
#
# The trailing slash on both the location and alias matters - dropping it
# breaks relative asset URLs under /buswankers/.
#
# index.html isn't given its own no-cache rule here (kept simple, matching
# the existing sibling-app block) - if stale deploys ever show up in a
# browser, add one the same way deploy-breaktackle-frontend.sh documents for
# the main RozeBowl app.
#
# The /buswankers/<name>_autofill.csv rewrite onto the API lives in
# buswankers-api.inc, not here - see the note there.

location /buswankers/ {
    alias /srv/BusWankersSharp/www/buswankers/;
    try_files $uri $uri/ /buswankers/index.html;
}
