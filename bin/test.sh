#! /usr/bin/env bash

trap "docker stop minio" EXIT

npm run clean
npm run storage

tape -r ts-node/register/transpile-only -r leaked-handles tests/**/*.ts | tap-arc
