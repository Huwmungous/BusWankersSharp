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
# exists. (deploy-buswankers-frontend.sh now ships and wires this file on
# every run, so in practice the manual step above only matters for a box
# that's never had a deploy.)
#
# The trailing slash on both the location and alias matters - dropping it
# breaks relative asset URLs under /buswankers/.
#
# index.html isn't given its own no-cache rule here (kept simple, matching
# the existing sibling-app block) - if stale deploys ever show up in a
# browser, add one the same way deploy-breaktackle-frontend.sh documents for
# the main RozeBowl app.

# The autofill files themselves are no longer static assets in the build -
# they're ingested into UploaderService's AutofillStore on intelligence (via
# the upload button on the page) and served back by
# GET /buswankers-api/api/autofill/files/{filename}. This regex location keeps
# the documented Remote Import URL, https://longmanrd.net/buswankers/g_autofill.csv
# etc, working unchanged by rewriting it onto that route. A regex location
# wins over the plain prefix block below for matching URIs, so it has to sit
# in the same server block as /buswankers/ (it does, via this include). The
# filename pattern here must agree with AutofillStore.IsSafeFileName.
location ~ ^/buswankers/[a-z0-9_]*autofill\.csv$ {
    rewrite ^/buswankers/(.*)$ /api/autofill/files/$1 break;
    proxy_pass http://intelligence.longmanrd.infoforum.co.uk:5038;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /buswankers/ {
    alias /srv/BusWankersSharp/www/buswankers/;
    try_files $uri $uri/ /buswankers/index.html;
}
