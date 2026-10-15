#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
staging=$(mktemp -d "$PWD/dist/build.XXXXXX")
trap 'rm -rf "$staging"' EXIT
# Stage a fresh export so removed files never survive into the next ZIP.
docker buildx build --platform linux/arm64 --target package \
  --output "type=local,dest=$staging/package" "$@" .
test -x "$staging/package/bin/frankenphp"
(cd "$staging/package" && zip -qr ../lambda-web.zip .)
rm -rf dist/package
mv "$staging/package" dist/package
mv "$staging/lambda-web.zip" dist/lambda-web.zip
ls -lh dist/lambda-web.zip
