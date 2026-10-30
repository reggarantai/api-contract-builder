#!/usr/bin/env bash
# Prints the CHANGELOG.md section of a version, for its GitHub release:
#   scripts/release-notes.sh 0.1.0
set -euo pipefail

version=${1:?usage: release-notes.sh <version>}
notes=$(awk -v version="$version" '
  $0 ~ "^## \\[" version "\\]" { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md)

if [[ -z "${notes//[[:space:]]/}" ]]; then
  echo "CHANGELOG.md has no notes for ${version}" >&2
  exit 1
fi
printf '%s\n' "$notes" | sed -e '/./,$!d'
