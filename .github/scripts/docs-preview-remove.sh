#!/usr/bin/env bash
set -euo pipefail

: "${SURGE_TOKEN:?DOCS_SURGE_TOKEN is required}"
: "${DOMAIN:?Preview domain is required}"
surge="$RUNNER_TEMP/surge/node_modules/.bin/surge"
# Listing first makes teardown idempotent without hiding authentication failures.
"$surge" list --all --token "$SURGE_TOKEN" > "$RUNNER_TEMP/surge-sites.txt"
sed -r 's/\x1B\[[0-9;]*[mK]//g' "$RUNNER_TEMP/surge-sites.txt" > "$RUNNER_TEMP/surge-sites-plain.txt"
if awk -v domain="$DOMAIN" '$1 == domain { found=1 } END { exit !found }' "$RUNNER_TEMP/surge-sites-plain.txt"; then
    "$surge" teardown "$DOMAIN" --token "$SURGE_TOKEN"
fi
