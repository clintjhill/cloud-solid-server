#! /usr/bin/env bash

pushd ../CommunitySolidServer
 npm run build
popd

tsc

componentsjs-generator -s dist
