# Reverse proxy to the BusWankersSharp Uploader web service (spreadsheet -> autofill
# generation + the live AutofillStore), running as systemd unit
# buswankers-uploader.service on INTELLIGENCE, port 5038 (assigned by
# IFGlobal.PortResolver, see PortResolver.cs).
#
# Installed to holly at /etc/nginx/conf.d/buswankers-api.inc and wired into the
# longmanrd.net HTTPS server block (the one with `listen ... 443`) by
# ReactApp/deploy-buswankers-frontend.sh on every run - do not hand-edit the
# copy on holly, change this file.
#
# Path-based proxy under the SAME origin as the frontend (https://longmanrd.net/buswankers/),
# so the upload page's fetch() calls need no CORS.

location /buswankers-api/ {
    proxy_pass http://intelligence.longmanrd.infoforum.co.uk:5038/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # xlsx uploads need more than nginx's 1m default.
    client_max_body_size 20m;
}

# The autofill files themselves are no longer static assets in the frontend
# build - they're ingested into UploaderService's AutofillStore (via the upload
# bar on the page) and served back by GET /api/autofill/files/{filename}. This
# regex location keeps the documented Remote Import URL,
# https://longmanrd.net/buswankers/g_autofill.csv etc, working unchanged by
# rewriting it onto that route. A regex location wins over the plain
# /buswankers/ prefix location (however that one is declared - included from
# buswankers.inc or written inline in the server block), so it has to sit in
# the same server block; it lives in THIS include rather than buswankers.inc
# because it's API routing, and because this include is the one the deploy
# script always wires. The filename pattern must agree with
# AutofillStore.IsSafeFileName.
location ~ ^/buswankers/[a-z0-9_]*autofill\.csv$ {
    rewrite ^/buswankers/(.*)$ /api/autofill/files/$1 break;
    proxy_pass http://intelligence.longmanrd.infoforum.co.uk:5038;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
