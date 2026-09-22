#!/usr/bin/env bash
set -euo pipefail

PERSONAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$PERSONAL_DIR/profile"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/web"

usage() {
  cat >&2 <<'EOF'
usage: sync.sh {push|pull}

  push    repo replica  -> live ~/.dsh
  pull    live ~/.dsh   -> repo replica

Env: DSH_HOME (default ~/.dsh)
EOF
  exit 1
}

# label:src:dest
MAPPINGS=(
  "package.json:$SRC/package.json:$PROFILE_DIR/package.json"
  "cordis.patch.yml:$SRC/cordis.patch.yml:$PROFILE_DIR/cordis.patch.yml"
  "pnpm-workspace.yaml:$SRC/pnpm-workspace.yaml:$PROFILE_DIR/pnpm-workspace.yaml"
  "settings.yaml:$SRC/settings.yaml:$DSH_HOME_DIR/settings.yaml"
)

[ $# -eq 1 ] || usage

case "$1" in
  push)
    for m in "${MAPPINGS[@]}"; do
      IFS=: read -r label src dest <<<"$m"
      mkdir -p "$(dirname "$dest")"
      if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
        echo "in sync: $label"
      else
        cp "$src" "$dest"
        echo "pushed:  $label -> $dest"
      fi
    done
    echo "Done. Restart the 'web' profile to apply bundle membership changes."
    ;;
  pull)
    for m in "${MAPPINGS[@]}"; do
      IFS=: read -r label src dest <<<"$m"
      if [ ! -f "$dest" ]; then
        echo "skipped: $label (no live file at $dest)"
      elif [ -f "$src" ] && cmp -s "$src" "$dest"; then
        echo "in sync: $label"
      else
        cp "$dest" "$src"
        echo "pulled:  $label <- $dest"
      fi
    done
    ;;
  *)
    usage
    ;;
esac
