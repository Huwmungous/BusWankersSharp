# nginx location block for the Bus Wankers frontend (static React SPA).
#
# Matches the include-file pattern used for the other longmanrd.net services
# (see Infoforum's IF.WebServices/Deployment/nginx/*.inc) and the exact
# alias/try_files shape already used for RozeBowl's sibling static app
# (Frontend/rozebowl-bot-dashboard's /rozebowl/bots/ block) - copy this file
# to holly at /etc/nginx/conf.d/buswankers.inc, then add:
#
#   include /etc/nginx/conf.d/buswankers.inc;
#
# inside the longmanrd.net server block at
# /etc/nginx/sites-available/longmanrd.net, alongside the config-webservice.inc
# / logger-webservice.inc / tokens-app.inc includes. Run
# ops/deploy/setup-holly-buswankers-links.sh first so the alias target below
# exists.
#
# The trailing slash on both the location and alias matters - dropping it
# breaks relative asset URLs under /buswankers/.
#
# index.html isn't given its own no-cache rule here (kept simple, matching
# the existing sibling-app block) - if stale deploys ever show up in a
# browser, add one the same way deploy-breaktackle-frontend.sh documents for
# the main RozeBowl app.

location /buswankers/ {
    alias /srv/BusWankersSharp/www/buswankers/;
    try_files $uri $uri/ /buswankers/index.html;
}
