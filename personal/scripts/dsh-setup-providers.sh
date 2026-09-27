#!/usr/bin/env bash
#
# dsh-setup-providers.sh — point the DeepSeek Harness at free / alternative
# LLM providers, then verify the keys actually work.
#
# What it touches (never the repo, never a chat transcript):
#   $DSH_HOME/.env            API keys, one NAME=value line each   (chmod 600)
#   $DSH_HOME/settings.yaml   llm-pi-ai.providers.<id>.apiKeyEnv route refs
#                             (+ agent-default-model with --default)
#
# The harness resolves a credential reference in this order:
#   process environment > $DSH_HOME/.credentials.yaml > <cwd>/.env > $DSH_HOME/.env
# Writing only to .env means a key saved later through the Models page still wins.
#
# Usage:
#   ./dsh-setup-providers.sh groq=gsk_xxx google=AIza_xxx openrouter=sk-or-xxx
#   ./dsh-setup-providers.sh --default groq llama-3.3-70b-versatile groq=gsk_xxx
#   ./dsh-setup-providers.sh --verify          # check every configured key
#   ./dsh-setup-providers.sh --dry-run groq=gsk_xxx
#
# Provider ids must be ones the installed pi-ai catalog already ships, so the
# endpoint, protocol, and model list need no configuration (see KNOWN below).

set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SETTINGS="$DSH_HOME/settings.yaml"
ENV_FILE="$DSH_HOME/.env"

# Built-in providers: adding one of these needs only an apiKeyEnv reference.
# Anything NOT listed also needs api/baseURL/models, which this script does not
# write — add those by hand or through Settings -> Models.
# Cerebras is listed for completeness but NOT recommended: it now looks like a
# one-time signup credit that wants a card, not an always-free tier.
KNOWN="anthropic cerebras cloudflare-workers-ai deepseek github-copilot google groq huggingface minimax mistral moonshotai nvidia openai openrouter together vercel-ai-gateway xai zai"

DRY_RUN=0
VERIFY=0
DEFAULT_PROVIDER=""
DEFAULT_MODEL=""
PAIRS=()

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ---- parse args -------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=1; shift ;;
    --verify)   VERIFY=1; shift ;;
    --default)  DEFAULT_PROVIDER="${2:-}"; DEFAULT_MODEL="${3:-}"; shift 3 ;;
    -h|--help)  usage 0 ;;
    --*)        die "unknown option '$1'" ;;
    *=*)        PAIRS+=("$1"); shift ;;
    *)          die "expected provider=KEY, got '$1'" ;;
  esac
done

[ -d "$DSH_HOME" ] || die "DSH_HOME not found: $DSH_HOME"
[ -f "$SETTINGS" ] || die "settings.yaml not found: $SETTINGS (run dsh web once)"
[ ${#PAIRS[@]} -gt 0 ] || [ "$VERIFY" -eq 1 ] || usage 1

# js-yaml ships inside the dsh installation; reuse it rather than adding a dep.
JY_PATH="$(npm root -g 2>/dev/null || true)/@deepseek-ai/dsh/node_modules/js-yaml"

# ---- verify: hit each provider's own /models endpoint -----------------------
# Same check as Models -> "Fetch available models": a real authenticated GET.
# A 200 proves the key and the endpoint; no model tokens are spent.
verify_provider() {
  local provider="$1" key="$2" url="" kind="bearer"
  case "$provider" in
    google)            url="https://generativelanguage.googleapis.com/v1beta/models"; kind="goog" ;;
    groq)              url="https://api.groq.com/openai/v1/models" ;;
    openrouter)        url="https://openrouter.ai/api/v1/key" ;;  # /models is public; /key is authenticated
    nvidia)            url="https://integrate.api.nvidia.com/v1/models" ;;
    mistral)           url="https://api.mistral.ai/v1/models" ;;
    huggingface)       url="https://router.huggingface.co/v1/models" ;;
    together)          url="https://api.together.ai/v1/models" ;;
    cerebras)          url="https://api.cerebras.ai/v1/models" ;;
    vercel-ai-gateway) url="https://ai-gateway.vercel.sh/v1/models" ;;
    deepseek)          url="https://api.deepseek.com/models" ;;
    *) printf '  %-20s skipped (no endpoint known — check Settings -> Models)\n' "$provider"; return 0 ;;
  esac

  local code
  if [ "$kind" = "goog" ]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H "x-goog-api-key: $key" "$url" || echo 000)"
  else
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $key" "$url" || echo 000)"
  fi

  # Google reports an invalid key as 400 INVALID_ARGUMENT rather than 401.
  case "$code" in
    200)         printf '  %-20s ✅ key works (HTTP 200)\n' "$provider" ;;
    400|401|403) printf '  %-20s ❌ key rejected (HTTP %s)\n' "$provider" "$code" ;;
    000)         printf '  %-20s ⚠️  no response (network / offline)\n' "$provider" ;;
    429)         printf '  %-20s ⚠️  rate limited — key is valid (HTTP 429)\n' "$provider" ;;
    *)           printf '  %-20s ⚠️  unexpected HTTP %s\n' "$provider" "$code" ;;
  esac
}

run_verify_all() {
  echo "verifying keys from $ENV_FILE"
  if [ ! -f "$ENV_FILE" ]; then echo "  (no .env yet — nothing to verify)"; return 0; fi
  local found=0 provider key ref
  while IFS= read -r provider; do
    [ -n "$provider" ] || continue
    ref="$(printf '%s' "$provider" | tr 'a-z-' 'A-Z_')_API_KEY"
    key="$(grep -m1 "^${ref}=" "$ENV_FILE" | cut -d= -f2- || true)"
    if [ -z "$key" ]; then
      printf '  %-20s ⚠️  no key in .env (%s)\n' "$provider" "$ref"
      continue
    fi
    verify_provider "$provider" "$key"
    found=1
  done < <(node -e '
    const fs=require("fs");
    const y=require(process.argv[2]);
    const d=y.load(fs.readFileSync(process.argv[1],"utf8"))||{};
    console.log(Object.keys((d["llm-pi-ai"]||{}).providers||{}).join("\n"));
  ' "$SETTINGS" "$JY_PATH" 2>/dev/null || true)
  [ "$found" -eq 1 ] || echo "  (no configured provider routes found in settings.yaml)"
}

# ---- verify-only invocation -------------------------------------------------
if [ "$VERIFY" -eq 1 ] && [ ${#PAIRS[@]} -eq 0 ]; then
  [ -d "$JY_PATH" ] || die "js-yaml not found at $JY_PATH (is dsh installed globally?)"
  run_verify_all
  exit 0
fi

# ---- validate pairs ---------------------------------------------------------
PROVIDERS=(); REFS=(); KEYS=()
for pair in "${PAIRS[@]}"; do
  provider="${pair%%=*}"; key="${pair#*=}"
  [ -n "$provider" ] || die "empty provider id in '$pair'"
  [ "$provider" != "$pair" ] || die "expected provider=KEY, got '$pair'"
  [ -n "$key" ] || die "empty key for '$provider'"
  case "$provider" in
    *[!a-z0-9-]*) die "provider id must be lowercase-hyphenated: '$provider'" ;;
  esac
  if ! printf '%s\n' $KNOWN | grep -qx -- "$provider"; then
    printf 'warning: "%s" is not a known built-in provider.\n' "$provider" >&2
    printf '         It also needs api/baseURL/models or the route is refused.\n' >&2
  fi
  # Reference name we choose ourselves, so it always matches what we write.
  REFS+=("$(printf '%s' "$provider" | tr 'a-z-' 'A-Z_')_API_KEY")
  PROVIDERS+=("$provider"); KEYS+=("$key")
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run — nothing written"
  for i in "${!PROVIDERS[@]}"; do
    printf '  <redacted>  ->  llm-pi-ai.providers.%s.apiKeyEnv=%s  (+ %s in .env)\n' \
      "${PROVIDERS[$i]}" "${REFS[$i]}" "${REFS[$i]}"
  done
  [ -n "$DEFAULT_PROVIDER" ] && printf '  agent-default-model -> %s/%s\n' "$DEFAULT_PROVIDER" "$DEFAULT_MODEL"
  exit 0
fi

# ---- write keys to $DSH_HOME/.env (idempotent, never echoed) ----------------
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
for i in "${!REFS[@]}"; do
  ref="${REFS[$i]}"; key="${KEYS[$i]}"
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  grep -v "^${ref}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$ref" "$key" >> "$tmp"
  mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  printf 'key stored: %s\n' "$ref"
done

# ---- merge provider routes into settings.yaml -------------------------------
[ -d "$JY_PATH" ] || die "js-yaml not found at $JY_PATH (is dsh installed globally?)"
cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
echo "backup: $SETTINGS.bak.*"

MERGE="$(mktemp)"
trap 'rm -f "$MERGE"' EXIT
cat > "$MERGE" <<'NODE'
const fs = require('fs');
const [settingsPath, jyPath, defaultProvider, defaultModel] = process.argv.slice(2);
const yaml = require(jyPath);
const doc = (fs.existsSync(settingsPath) && yaml.load(fs.readFileSync(settingsPath, 'utf8'))) || {};

doc['llm-pi-ai'] = doc['llm-pi-ai'] || {};
doc['llm-pi-ai'].providers = doc['llm-pi-ai'].providers || {};

let n = 0;
for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
  const [provider, ref] = line.trim().split(/\s+/);
  if (!provider) continue;
  // Merge: keep any other fields an existing profile already carries.
  doc['llm-pi-ai'].providers[provider] = Object.assign(
    {}, doc['llm-pi-ai'].providers[provider], { apiKeyEnv: ref },
  );
  n += 1;
}
if (defaultProvider) {
  doc['agent-default-model'] = Object.assign(
    {}, doc['agent-default-model'], { provider: defaultProvider, model: defaultModel },
  );
}
fs.writeFileSync(settingsPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
console.log(`settings.yaml: ${n} provider route(s) configured`);
NODE

{
  for i in "${!PROVIDERS[@]}"; do printf '%s %s\n' "${PROVIDERS[$i]}" "${REFS[$i]}"; done
} | node "$MERGE" "$SETTINGS" "$JY_PATH" "$DEFAULT_PROVIDER" "$DEFAULT_MODEL"

# ---- optional immediate verification ---------------------------------------
if [ "$VERIFY" -eq 1 ]; then
  echo
  run_verify_all
fi

cat <<EOF

Done.

Next:
  1. Restart the harness so the new .env is read:   dsh web
     (settings.yaml hot-reloads on its own; .env may only be read at launch.)
  2. Settings -> Models: each provider row should show a green key dot.
  3. End-to-end:  dsh --profile headless "Reply with exactly: OK"

Keys live in $ENV_FILE (chmod 600), NOT in this repo. Never put API keys in a
project .env inside personal-os — that file would be committed.
EOF
