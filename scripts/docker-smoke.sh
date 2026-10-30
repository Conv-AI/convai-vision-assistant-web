#!/usr/bin/env bash
# Starts the Docker image with no Convai key and checks what a first visitor would meet:
#   docker build -t vision-assistant:ci . && bash scripts/docker-smoke.sh vision-assistant:ci
#
# CI never connects to Convai, so /api/token must give the safe error for a missing key.
set -euo pipefail

image="${1:?usage: docker-smoke.sh <image>}"
name="vision-assistant-smoke"
base="http://127.0.0.1:8080"

fail() {
  echo "docker-smoke: $1" >&2
  docker logs "$name" >&2 || true
  exit 1
}

docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -p 8080:8080 "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

# Wait for the server to listen: up to 30 s, one look a second.
for _ in $(seq 30); do
  if curl -fs -o /dev/null "$base/"; then break; fi
  sleep 1
done

page=$(curl -fsS "$base/") || fail "/ did not answer."
grep -q '<title>Convai Vision Assistant</title>' <<<"$page" || fail "/ did not answer the page."

body=$(mktemp)
status=$(curl -s -o "$body" -w '%{http_code}' "$base/api/token")
[ "$status" = 500 ] || fail "/api/token answered $status without a key, not 500."
expected='{"error":"CONVAI_API_KEY is not set. Set it in the server'"'"'s environment and restart the server."}'
[ "$(cat "$body")" = "$expected" ] || fail "/api/token answered $(cat "$body")."

[ "$(docker exec "$name" id -u)" != 0 ] || fail "the server runs as root."
leftovers=$(docker exec "$name" find /app -name '.env*' -o -name node_modules)
[ -z "$leftovers" ] || fail "the image holds $leftovers."

# The server closes on SIGTERM; a server that ignored it would be killed after the 10 s grace.
start=$(date +%s)
docker stop -t 10 "$name" >/dev/null
[ $(($(date +%s) - start)) -lt 5 ] || fail "the server did not stop on SIGTERM."

echo "docker-smoke: the page, the missing-key error, a non-root user, no secrets and a clean stop."
