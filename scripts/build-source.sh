#!/usr/bin/env bash
# Optional clean source build using FrankenPHP's official StaticPHP build target.
set -euo pipefail
cd "$(dirname "$0")/.."
version=1.13.0
mkdir -p work
source_dir="$PWD/work/frankenphp-$version"
if [[ ! -d "$source_dir" ]]; then
  curl -fL --retry 3 "https://codeload.github.com/php/frankenphp/tar.gz/refs/tags/v$version" -o work/frankenphp.tar.gz
  tar -xzf work/frankenphp.tar.gz -C work
fi
(
  cd "$source_dir"
  VERSION="$version" docker buildx bake --load static-builder-musl \
    --set static-builder-musl.platform=linux/arm64 \
    --set static-builder-musl.tags=staticphp-poc-source:local \
    --set static-builder-musl.args.FRANKENPHP_VERSION="$version" \
    --set static-builder-musl.args.PHP_VERSION=8.5.11 \
    --set static-builder-musl.args.PHP_EXTENSIONS=opcache
)
# Same packaging path as the default build, but use the locally rebuilt image.
./scripts/build.sh --build-arg STATIC_BUILDER=staticphp-poc-source:local
