#!/usr/bin/env bash
# Runs a built image the way users do and checks it works:
#   scripts/smoke-test-image.sh <image> [platform]   e.g. linux/arm64
# Uses port 3200 (override with SMOKE_PORT) and removes its container and
# volume when it ends, even on failure.
set -euo pipefail

image=${1:?usage: smoke-test-image.sh <image> [platform]}
platform=${2:-}
port=${SMOKE_PORT:-3200}
name="acb-smoke-$$"
volume="acb-smoke-data-$$"
base="http://127.0.0.1:${port}"
platform_args=()
if [[ -n "$platform" ]]; then
  platform_args=(--platform "$platform")
fi

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  docker logs "$name" 2>&1 | tail -20 >&2 || true
  exit 1
}

start() {
  docker run -d --name "$name" "${platform_args[@]}" \
    -p "127.0.0.1:${port}:3000" -v "${volume}:/data" "$image" >/dev/null
}

# Docker Desktop accepts connections before the app is up, so retry on any
# error, and treat an empty answer as a failure.
wait_until_up() {
  local body
  body=$(curl -sf --retry 60 --retry-delay 1 --retry-all-errors "${base}/api/health") ||
    fail "the app didn't answer on ${base}/api/health"
  [[ -n "$body" ]] || fail "empty answer from /api/health"
}

json() { node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log($1)"; }

start
wait_until_up
echo "ok: answers on /api/health"

# Arch and non-root user. A multi-platform tag can point at several images,
# so the platform asked for decides which arch to expect.
expected_arch=${platform#linux/}
if [[ -z "$platform" ]]; then
  expected_arch=$(docker inspect "$name" --format '{{.Image}}' | xargs docker image inspect --format '{{.Architecture}}')
fi
[[ "$expected_arch" == amd64 ]] && expected_arch=x64
actual_arch=$(docker exec "$name" node -p 'process.arch')
[[ "$actual_arch" == "$expected_arch" ]] || fail "runs as ${actual_arch}, expected ${expected_arch}"
[[ "$(docker exec "$name" node -p 'process.getuid()')" != "0" ]] || fail "runs as root"
echo "ok: runs as ${actual_arch}, not as root"

# The sample project exports with no warnings, as OpenAPI and as Markdown.
project=$(curl -sf -X POST "${base}/api/samples") || fail "couldn't create the sample project"
project_id=$(echo "$project" | json 'd.id')
report=$(curl -sf "${base}/api/projects/${project_id}/export/report")
[[ "$(echo "$report" | json 'd.valid && d.warnings.length === 0')" == "true" ]] ||
  fail "the sample's export report isn't clean: $report"
zip_type=$(curl -sf -o /dev/null -w '%{content_type}' "${base}/api/projects/${project_id}/export/markdown")
[[ "$zip_type" == "application/zip" ]] || fail "the Markdown export answered ${zip_type}"
echo "ok: the sample project exports"

# Data survives a restart of the container.
docker restart "$name" >/dev/null
wait_until_up
count=$(curl -sf "${base}/api/projects" | json 'd.length')
[[ "$count" == "1" ]] || fail "expected 1 project after a restart, found ${count}"
echo "ok: data survives a restart"

# The healthcheck reports healthy.
for _ in $(seq 1 60); do
  status=$(docker inspect "$name" --format '{{.State.Health.Status}}')
  [[ "$status" == "healthy" ]] && break
  sleep 1
done
[[ "$status" == "healthy" ]] || fail "the healthcheck says ${status}"
echo "ok: the healthcheck says healthy"

# Labels say where the image comes from.
source_label=$(docker inspect "$name" --format '{{index .Config.Labels "org.opencontainers.image.source"}}')
[[ "$source_label" == "https://github.com/reggarantai/api-contract-builder" ]] ||
  fail "org.opencontainers.image.source is '${source_label}'"
echo "ok: labeled with its source"

# The only native binary is SQLite's for this platform; its C sources and the
# binaries for other platforms are left out. The image has no shell, so Node
# looks.
natives=$(docker exec "$name" node -e '
  const fs = require("fs");
  const path = require("path");
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".node")) found.push(file);
    }
  })("node_modules/.pnpm");
  const sqlite = fs.readdirSync("node_modules/.pnpm").find((d) => d.startsWith("better-sqlite3@"));
  if (fs.existsSync(`node_modules/.pnpm/${sqlite}/node_modules/better-sqlite3/deps`)) found.push("C sources");
  console.log(found.join("\n"));
')
[[ "$natives" == */better-sqlite3/prebuilds/linux-${actual_arch}.node && "$natives" != *$'\n'* ]] ||
  fail "native binaries in node_modules: ${natives//$'\n'/ }"
echo "ok: the only native binary is better-sqlite3's linux-${actual_arch}.node"

# Nothing to run but Node: no shell and no package manager.
extras=$(docker exec "$name" node -e '
  const fs = require("fs");
  const tools = ["sh", "bash", "dash", "apt", "apt-get", "dpkg", "apk", "npm", "npx", "yarn", "corepack"];
  const dirs = (process.env.PATH ?? "").split(":");
  console.log(tools.filter((tool) => dirs.some((dir) => fs.existsSync(`${dir}/${tool}`))).join(" "));
')
[[ -z "$extras" ]] || fail "the image ships: ${extras}"
echo "ok: no shell or package manager"

echo "PASS: ${image}${platform:+ (${platform})}"
