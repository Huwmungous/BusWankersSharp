#!/usr/bin/env bash
# BusWankersSharp repository verification gate.
#
# Run by the Git MCP server (IFSourceControl VerificationRunner) against a
# task worktree before a pull request may be opened. Exit 0 = verified,
# non-zero = refuse to publish. Mirrors the shape of Infoforum's own
# tools/infoforum_verify.sh - the gate is repository-owned so a change under
# test cannot rewrite the thing that judges it.
#
# Only the .NET projects (AutofillFromCSV, CSVFromSpreadsheet, Common,
# UploaderService) are covered here via the solution build - ReactApp is a
# separate CRA app with its own npm-based build, not part of
# BusWankersSharp.sln, and isn't gated by this script.
#
# No test projects exist in this repo yet, so there's no `dotnet test` step -
# add one here the day a *.Tests.csproj shows up, matching infoforum_verify.sh.
#
# Usage: bash tools/buswankers_verify.sh   (cwd = worktree root; the runner
#        passes the absolute script path and sets cwd itself)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOTNET_ARGS=(--nologo -v minimal)
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

step() { printf '\n=== %s ===\n' "$*"; }

step "build BusWankersSharp.sln"
dotnet build BusWankersSharp.sln "${DOTNET_ARGS[@]}"

step "buswankers_verify: PASSED"
