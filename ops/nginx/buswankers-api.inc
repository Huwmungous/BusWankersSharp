# Reverse proxy to the BusWankersSharp Uploader web service (spreadsheet -> autofill
# generation), running as systemd unit buswankers-uploader.service on
# INTELLIGENCE (not queeg - queeg only builds and ships it there, see
# UploaderService/deploy-buswankers-backend.sh), port 5038 (assigned by
# IFGlobal.PortResolver, see PortResolver.cs).
#
# Copy to holly at /etc/nginx/conf.d/buswankers-api.inc, then add:
#   include /etc/nginx/conf.d/buswankers-api.inc;
# inside the longmanrd.net server block, alongside buswankers.inc and the other
# *-webservice.inc / *-app.inc includes.
#
# Path-based proxy under the SAME origin as the frontend (https://longmanrd.net/buswankers/),
# so the upload page's fetch() calls need no CORS.
#
# NB: check this against however your other webservice .inc files (config-webservice.inc
# etc.) actually reach intelligence - if those use a different hostname/IP or your firewall
# blocks 5038, adjust proxy_pass and the SERVICE_PORT in deploy-buswankers-backend.sh
# to match (they must agree).

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
