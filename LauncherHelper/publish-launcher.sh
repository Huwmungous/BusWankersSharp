#!/usr/bin/env bash
# Publishes the sale-day launcher helper as one self-contained, single-file zip per
# platform, ready to be served as static files from the page's build/launcher/ folder:
#
#   BusWankersLauncher-win-x64.zip     Windows (Intel/AMD)
#   BusWankersLauncher-osx-arm64.zip   Mac, Apple silicon
#   BusWankersLauncher-osx-x64.zip     Mac, Intel
#   BusWankersLauncher-linux-x64.zip   Linux
#
# Each zip holds the program plus README.txt (README-download.txt), and nothing needs
# installing to run it: the .NET runtime is bundled. Called by
# ReactApp/deploy-buswankers-frontend.sh after the Vite build (so build/ has already
# been emptied and refilled); it can be run by hand too.
#
# Usage: publish-launcher.sh <output-dir> [rid ...]
#   <output-dir>  where the zips go (created if missing)
#   rid ...       publish only these runtime identifiers (default: all four above)
#
# Exit status is the number of platforms that failed (0 = all good). A failure for one
# platform does not stop the others; the caller decides whether that matters.
#
# Needs: the .NET SDK (and NuGet access for the runtime packs the first time), plus
# either `zip` or `python3` to make the archives.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$HERE/LauncherHelper.csproj"
README="$HERE/README-download.txt"

OUT="${1:-}"
if [ -z "$OUT" ]; then
    echo "usage: $0 <output-dir> [rid ...]" >&2
    exit 64
fi
shift

RIDS=("$@")
if [ "${#RIDS[@]}" -eq 0 ]; then
    RIDS=(win-x64 osx-arm64 osx-x64 linux-x64)
fi

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

log() { printf '[launcher] %s\n' "$*"; }

if ! command -v dotnet >/dev/null 2>&1; then
    log "dotnet not found - cannot publish the launcher helper"
    exit 127
fi

make_zip() {   # <source-dir> <zip-path>
    local src="$1" zip="$2"
    rm -f "$zip"
    if command -v zip >/dev/null 2>&1; then
        (cd "$src" && zip -qr "$zip" .)
    elif command -v python3 >/dev/null 2>&1; then
        # ZipFile.write keeps each file's permission bits, so the program stays executable.
        python3 - "$src" "$zip" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for name in sorted(files):
            path = os.path.join(root, name)
            z.write(path, os.path.relpath(path, src))
PY
    else
        log "neither zip nor python3 is available - cannot make $zip"
        return 1
    fi
}

mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failed=0
for rid in "${RIDS[@]}"; do
    dir="$WORK/$rid"
    log "publishing $rid ..."
    if ! dotnet publish "$PROJECT" -c Release -r "$rid" --self-contained true \
            -p:PublishSingleFile=true \
            -p:IncludeNativeLibrariesForSelfExtract=true \
            -p:DebugType=none -p:DebugSymbols=false \
            -o "$dir" --nologo -v quiet; then
        log "FAILED to publish $rid"
        failed=$((failed + 1))
        continue
    fi

    cp "$README" "$dir/README.txt"
    # Belt and braces: the single-file publish is executable already, but say so.
    [ -f "$dir/BusWankersLauncher" ] && chmod +x "$dir/BusWankersLauncher"

    zip_path="$OUT/BusWankersLauncher-$rid.zip"
    if make_zip "$dir" "$zip_path"; then
        log "wrote $zip_path ($(du -h "$zip_path" | cut -f1))"
    else
        failed=$((failed + 1))
    fi
done

if [ "$failed" -eq 0 ]; then
    log "all ${#RIDS[@]} platform(s) published to $OUT"
else
    log "$failed of ${#RIDS[@]} platform(s) failed"
fi
exit "$failed"
