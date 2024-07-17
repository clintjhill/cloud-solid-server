#! /usr/bin/env bash

trap "docker stop minio" EXIT

npm run clean
npm run storage
npm run build

tape -r ts-node/register/transpile-only -r leaked-handles tests/**/*.ts | tap-arc --bail

echo "Bucket 'localhost/test-data' after all tests:"
echo
mc ls --recursive localhost/test-data
