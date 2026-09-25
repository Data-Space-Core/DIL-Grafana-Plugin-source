#!/bin/sh
set -eu

output="${1:-dist}"
mkdir -p "$output"
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
    os="${target%/*}"
    arch="${target#*/}"
    suffix=""
    if [ "$os" = windows ]; then suffix=".exe"; fi
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -mod=readonly -trimpath \
        -ldflags="-s -w -buildid=" -o "$output/gpx_dil_${os}_${arch}${suffix}" ./pkg
done
