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

# Upstream by IP, matching every other intelligence-hosted service in holly's
# longmanrd.conf (rbapi, ifconfig, iflogger, the MCP upstreams are all
# 192.168.0.200:<port>) - no dependence on holly resolving the AD name at
# config load. intelligence's firewalld must allow 5038/tcp from holly
# (192.168.0.252); buswankers-remote-install.sh opens that.
location /buswankers-api/ {
    proxy_pass http://192.168.0.200:5038/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # xlsx uploads need more than nginx's 1m default.
    client_max_body_size 20m;
}

# The SPA entry point must never be cached. CRA's JS/CSS bundles carry a
# content hash in their names, so those can be cached forever - but the
# index.html that points at them is served by the plain /buswankers/ location
# with no Cache-Control at all, and browsers then cache it heuristically (10%
# of its age). Result on 2026-09-16: after a deploy, Hugh's tab kept running
# a two-releases-old bundle whose dropdown still looked for bw_autofill.csv,
# and reported every sale "(empty)" while the store plainly had the files. A
# regex location wins over the inline prefix block, so this takes over just
# "/buswankers/" and "/buswankers/index.html" and adds the no-cache headers;
# every other asset still goes through the prefix block untouched. Same
# rule deploy-breaktackle-frontend.sh applies to the main RozeBowl app.
#
# root + try_files, NOT `alias .../index.html`: for the bare "/buswankers/"
# request the URI ends in "/", so nginx hands it to the index module, which
# appended "index.html" to the aliased FILE path and failed with
# ".../index.htmlindex.html is not a directory" -> HTTP 500 on the landing
# page (2026-09-22). try_files with an explicit file serves it directly and
# never reaches the index module; the MIME type comes from the .html name.
location ~ ^/buswankers/(index\.html)?$ {
    root /srv/BusWankersSharp/www;
    try_files /buswankers/index.html =404;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Pragma "no-cache";
    add_header Expires "0";
}

# The autofill files themselves are no longer static assets in the frontend
# build - they're ingested into UploaderService's AutofillStore (via the upload
# bar on the page) and served back by GET /api/autofill/files/{filename}. This
# regex location keeps the documented Remote Import URL,
# https://longmanrd.net/buswankers/general_autofill.csv etc, working by
# rewriting it onto that route. A regex location wins over the plain
# /buswankers/ prefix location (however that one is declared - included from
# buswankers.inc or written inline in the server block), so it has to sit in
# the same server block; it lives in THIS include rather than buswankers.inc
# because it's API routing, and because this include is the one the deploy
# script always wires. The filename pattern must agree with
# AutofillStore.IsSafeFileName.
location ~ ^/buswankers/[a-z0-9_]*autofill\.csv$ {
    rewrite ^/buswankers/(.*)$ /api/autofill/files/$1 break;
    proxy_pass http://192.168.0.200:5038;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
