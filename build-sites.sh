#!/usr/bin/env bash
# Genera deploy-public/ (assets publicos) y valida el Worker antes de desplegar.
# Uso: bash build-sites.sh
set -euo pipefail
cd "$(dirname "$0")"

out="deploy-public"
rm -rf "$out"
mkdir -p "$out"

cp fixture-finder.html "$out/fixture-finder.html"
cp fixture-finder.html "$out/index.html"
cp drive-index.js "$out/drive-index.js"
cp prompt.js "$out/prompt.js"
cp jobs.js "$out/jobs.js"

echo "assets: $(ls -1 "$out" | tr '\n' ' ')"
echo "worker: $(wc -c < worker/index.js) bytes"
