#! /usr/bin/env bash

trap "docker stop minio" EXIT

npm run clean
npm run storage
npm run build

# Adding the quiet flag just runs tests with no output.
if [[ "$1" == "-q" ]]
then
  tape -r ts-node/register/transpile-only -r leaked-handles tests/**/*.ts | tap-pessimist
  echo "Tests Succeeded."
else
  if tape -r ts-node/register/transpile-only -r leaked-handles tests/**/*.ts | tap-arc --bail;
  then
    echo "Tests Succeeded."
  else
    # tests fail and show the locahost data tree.
    echo "Bucket 'localhost/test-data' after all tests:"
    echo
    mc ls --recursive localhost/test-data
  fi
fi
