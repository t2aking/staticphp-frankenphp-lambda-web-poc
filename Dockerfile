# syntax=docker/dockerfile:1
# This official builder already contains a StaticPHP-compiled fully static binary.
# For a fresh source build see scripts/build-source.sh.
ARG STATIC_BUILDER=dunglas/frankenphp:static-builder-musl-1.13.0@sha256:90fbfc9aa7ad15d912f5e7f3772787e6fe558c011041159cfc205b891a844680
FROM ${STATIC_BUILDER} AS binary

FROM scratch AS package
COPY --from=binary --chmod=755 /go/src/app/dist/frankenphp-linux-aarch64 /bin/frankenphp
COPY index.js package.json /
COPY lib /lib
COPY public /public

# Local Linux smoke-test environment, not a Lambda container deployment image.
FROM node:24-bookworm-slim AS local
WORKDIR /app
COPY --from=package / /app/
COPY scripts/smoke.js scripts/compare-modes.js /app/scripts/
ENV AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000
USER node
EXPOSE 3000
CMD ["node", "index.js"]
