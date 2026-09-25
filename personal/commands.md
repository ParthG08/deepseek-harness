# dsh — build, apply, and restart commands

Quick reference for the loop: **edit → build → apply → see it in the UI**.

Targets the `web` profile on this machine. `DSH_HOME` is `~/.dsh`, the live
profile is `~/.dsh/profiles/web`, and the Web UI is `http://127.0.0.1:3080`.

## Decide by what you changed

| You changed | Build | Restart `dsh web`? |
|-------------|-------|--------------------|
| Client plugin source — `packages/client/*/src/**` | `pnpm run build:lib:client` | **No** — HMR reloads it in place |
| Host plugin source — `personal/plugins/*/index.js` | none — plain JS | **Yes** |
| Profile config — `~/.dsh/profiles/web/cordis.patch.yml` | none | **No** — `patchReload: live` |
| `~/.dsh/settings.yaml` | none | **No** — settings resolve per request |
| Add or remove a plugin (bundle membership) | depends on the plugin | **Yes** |

The two plugin classes behave differently, and this is the usual source of
"I rebuilt but nothing happened":

- **Client (UI) plugins** ship a built `lib/client.js`. `dsh-client-hmr`
  stat-polls every graph row's client bundle every 500 ms and swaps the plugin
  in place, so a rebuild is enough — no restart, no page reload.
- **Host-only plugins** ship plain `index.js` and are loaded once at startup.
  Nothing watches them, so any host source change needs a restart.

## Environment

Every command below assumes Node 22 and pnpm 11. The global `dsh` CLI and the
running server must share one Node major, or `dsh plugin` fails with
`ERR_SQLITE_ERROR` from pnpm.

```sh
nvm use 22.23.2
corepack enable && corepack prepare pnpm@11.7.0 --activate
```

## Build

```sh
pnpm install                 # after a pull, or when dependencies change
pnpm run build:lib           # host + client (use this when unsure)
pnpm run build:lib:client    # client bundles only — what a UI plugin change needs
pnpm run build:lib:host      # host bundles only
```

`pnpm run build` additionally runs the full artifact pass. For this repo the
narrow `build:lib` is almost always what you want.

`lib/` is **gitignored** (`.gitignore:4`), so a fresh clone has no client bundle
until you build. That is why a `git pull` alone never applies a plugin change.

### Watch mode

```sh
pnpm run dev:web             # tsx scripts/dev-web.ts --poll
```

Rebuilds client plugin bundles on every source change. With this running, the
HMR chain reloads the plugin ~500 ms later with no manual build. Without it, run
`build:lib:client` yourself — a one-shot rebuild is also picked up, because HMR
watches the bundle's mtime and size, not the watcher.

`dev:web` only rebuilds client bundles. Anything else — the `apps/web` shell,
plain packages, host plugins — still needs the manual build and restart below.

## Restart the Web profile

```sh
# stop the running server (Ctrl+C in its terminal), then:
dsh web
```

Restart is required only when **bundle membership** changes — adding or removing
a plugin, or editing the `dsh.profile.bundles` list. A restart is *not* needed
for config edits (`patchReload: live`) or for client plugin code (HMR).

If you launched the server detached and cannot find it, capture the log on the
next start instead — DSH writes all logging to **stderr** and keeps no log file:

```sh
dsh web 2>&1 | tee ~/dsh-web.log
```

## Install a plugin into the profile

First-time install, or after adding a new plugin to the repo:

```sh
dsh plugin --profile web add link:$(pwd)/packages/client/session-quick-switch
dsh plugin --profile web add link:$(pwd)/personal/plugins/workspace-model-pin
dsh web                      # bundle membership is read at startup
```

`link:` points at a local directory, so the plugin is used from the checkout
rather than copied. **Pass an absolute path** (`$(pwd)/...`): `dsh` forwards the
spec to pnpm verbatim and only anchors bare `.`/`..` forms, so a `~` is not
expanded and `link:~/...` resolves inside the profile instead. `dsh plugin add`
rewrites `~/.dsh/profiles/web/package.json` for this machine, which is how the
`link:` targets get corrected after a clone.

Installed plugins in this profile:

| Plugin | Class | Source |
|--------|-------|--------|
| `@deepseek-ai/dsh-client-session-quick-switch` | client | `packages/client/session-quick-switch` |
| `dsh-workspace-model-pin` | host | `personal/plugins/workspace-model-pin` |
| `dsh-cursor-subscription` | host | npm |
| `dsh-task-worktree` | host | npm |
| `dsh-approval-hotkeys` | host | npm |

## Sync the profile replicas

`personal/profile/` holds replicas of the live `~/.dsh` files.

```sh
bash personal/sync.sh push   # repo replica  -> live ~/.dsh
bash personal/sync.sh pull   # live ~/.dsh   -> repo replica
```

`push` is what makes a fresh machine match this one. It copies `package.json`,
`cordis.patch.yml`, `pnpm-workspace.yaml`, and `settings.yaml`; it does **not**
install plugins or touch `node_modules`. Follow it with the `dsh plugin add`
commands above, then restart.

## Verify what actually loaded

```sh
dsh --profile web --dump-config           # composed tree including patch layers
dsh --profile web --dump-default-config   # bundle layers only, no patches
```

`--dump-config` is the fastest way to confirm a patch row landed. Expect exactly
one `workspace-model-pin` row carrying your rules; with no rules the plugin
loads inert and warns once.

Check bundle membership directly:

```sh
grep -A10 '"bundles"' ~/.dsh/profiles/web/package.json
```

Edited a config file and want to know whether it reloaded? `patchReload: live`
means yes, with no restart.

## Inspect a running or stalled session

```sh
tail -40 ~/.dsh/cursor-hang-trace.log      # Cursor provider stall reports
tail -f ~/.dsh/cursor-hang-trace.log       # watch for one live
grep -c '^=== ' ~/.dsh/cursor-hang-trace.log
```

The durable session log is the authoritative record — every model-visible event
is reconstructable from it:

```sh
cd ~/.dsh/sessions/--Users-parth.gupta-Desktop-Khatabook-sales--/<session-id>
zstd -dc session.v3.jsonl.zstd | tail -30 | jq .
```

Map a session id to its repository:

```sh
find ~/.dsh/sessions -maxdepth 2 -type d -name 'session-<id>' | sed 's|.*/sessions/||'
```

## Gotchas that cost time

- **`lib/` does not travel through git.** Pull + reopen never applies a client
  plugin change; you must build.
- **Adding a bundle needs a restart.** `patchReload: live` covers config edits
  only.
- **Absolute paths in the replicas are machine-specific.** `link:` targets and
  the `match:` rules in `cordis.patch.yml` both hardcode
  `/Users/parth.gupta/...`. Wrong username or clone path means dangling links
  (loud) or rules that silently never match (quiet — the plugin reports inert).
- **`pnpm run dev:web` must run from this checkout** for its rebuilds to reach
  the HMR receiver.
- **Never edit `cordis.yml`.** It is generated. Edit `cordis.patch.yml`.
- **Peer-dependency warnings are expected.** The profile sets
  `autoInstallPeers: false` on purpose; the harness injects its own
  `@deepseek-ai/*` packages at runtime.

## Related

- [setup.md](setup.md) — install, configuration layering, provider caveats.
- [README.md](README.md) — what lives in `personal/` and the replica map.
