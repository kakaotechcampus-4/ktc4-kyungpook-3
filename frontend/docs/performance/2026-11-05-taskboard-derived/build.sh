#!/bin/sh
# usage: sh build.sh <out.js>  — frontend/src 의 지금 코드로 minify 한 프로덕션 모양 번들을 만든다 (Bench.run)
HERE=$(cd "$(dirname "$0")" && pwd)
FE="$HERE/../../.."
"$FE/node_modules/.bin/esbuild" "$HERE/bench.ts" --bundle --minify --format=iife --global-name=Bench --platform=browser --target=es2022 \
  --alias:@="$FE/src" --define:process.env.NODE_ENV='"production"' \
  --define:import.meta.env='{"DEV":false,"PROD":true,"MODE":"production","VITE_ENABLE_MSW":"false","VITE_API_BASE_URL":""}' \
  --log-level=warning --outfile="$1"
