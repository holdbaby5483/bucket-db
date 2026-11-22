#!/usr/bin/env bash
# Size and dependency gates (ROADMAP §2 "小巧"). Run after `bun run build`.
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

dependencies=$(node -p "Object.keys(require('./package.json').dependencies ?? {}).length")
# The library and CLI keep the original budget; the query UI (src/ui, `bucket-db ui`) has its own.
source_lines=$(find src -name '*.ts' -not -path 'src/ui/*' -exec cat {} + | wc -l | tr -d ' ')
ui_lines=$(find src/ui -name '*.ts' -exec cat {} + | wc -l | tr -d ' ')
tarball=$(npm pack --silent --pack-destination "$work")
packed_bytes=$(wc -c < "$work/$tarball" | tr -d ' ')
(
  cd "$work"
  npm init -y >/dev/null
  npm install --silent --no-audit --no-fund "./$tarball" >/dev/null
)
installed_packages=$(find "$work/node_modules" -name package.json -not -path '*/node_modules/*/node_modules/*' -not -path '*/dist/*' | wc -l | tr -d ' ')
# apparent bytes, not disk blocks, so the number does not depend on the filesystem
installed_bytes=$(find "$work/node_modules" -type f -exec cat {} + | wc -c | tr -d ' ')

failed=0
check() { # name actual limit unit
  if [ "$2" -le "$3" ]; then status=ok; else status=FAIL; failed=1; fi
  printf '%-22s %8s %-3s (limit %s)  %s\n' "$1" "$2" "$4" "$3" "$status"
}
check 'runtime dependencies' "$dependencies" 0 ''
check 'installed packages' "$installed_packages" 1 ''
check 'installed size' "$installed_bytes" 204799 B
check 'tarball size' "$packed_bytes" 51200 B
check 'source lines' "$source_lines" 2070 ''
check 'ui server lines' "$ui_lines" 300 ''
exit $failed
