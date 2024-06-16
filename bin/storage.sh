#! /usr/bin/env bash

mkdir -p ./.data

docker run \
    -d \
    --rm \
    -p 9000:9000 \
    -p 9001:9001 \
    --name minio \
    -v ./.data:/data \
    -e "MINIO_ROOT_USER=ROOTNAME" \
    -e "MINIO_ROOT_PASSWORD=CHANGEME123" \
    quay.io/minio/minio server /data --console-address ":9001"
