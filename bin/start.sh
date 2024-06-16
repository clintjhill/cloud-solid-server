#! /usr/bin/env bash

trap "docker stop minio" EXIT

npm run clean
npm run build
npm run storage

# Debugger setup
# node --inspect ./node_modules/@solid/community-server/bin/server.js -c config/cloud-file.json -m . -p 3001 

# Server with our Cloud components
# community-solid-server -c config/cloud-file.json -f data -m . -p 3001

# Server with native File System components
community-solid-server -c @css:config/file.json -f data -m . -p 3001
#
# 2024-06-15T01:29:37.524Z [GeneratedPodManager] {Primary} info: Creating pod http://localhost:3001/test-pod/
# CloudDataAccessor:getMetadata - START data/test-pod/ http://localhost:3001/test-pod/
