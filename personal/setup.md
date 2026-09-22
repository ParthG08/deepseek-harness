# DeepSeek Harness (dsh) — Setup & Customizations

Setup notes for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`),
an **everything-is-a-plugin** agent harness built on
[Cordis](https://github.com/cordiverse/cordis).

This fork carries our customizations alongside the upstream source. `personal/`
holds the setup notes, the profile replicas, and the sync script; the client
plugin source lives under `packages/client/`, where the monorepo build finds it.

## Repository model

| Ref | Contents | Rule |
|-----|----------|------|
| `master` | mirror of upstream | never commit here |
| `feat/session-quick-switch` | our plugin + `personal/` | customization rides a branch |

```sh
git fetch upstream                    # bring in upstream work
git merge upstream/master             # fast-forward master
git rebase upstream/master <branch>   # replay our commits onto newer upstream
```

A client (UI) plugin cannot build standalone: the preset
`packages/client/tsdown.client.ts` scans `packages/*/*/package.json`, so it must
sit inside a checkout's `packages/client/`. That is why the plugin source lives
in this repo rather than a separate one.

## Installed state (as recorded)

| Item | Value |
|------|-------|
| Package | `@deepseek-ai/dsh` |
| Version | `0.1.5-rc.2` (developer preview — breaking changes expected) |
| Binary | `~/.nvm/versions/node/v22.23.2/bin/dsh` |
| `DSH_HOME` | `~/.dsh` |
| Profile | `web` → `~/.dsh/profiles/web` |
| Bundles | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app` |
| `patchReload` | `live` (config edits hot-reload) |
| Web UI | `http://127.0.0.1:3080` |

### Node version — use 22.23.2

`dsh` was originally installed under Node **20.9.0**, but the running Web
server is Node **22.23.2** and `dsh-cursor-subscription` declares
`engines.node: "^22.19.0 || >=24.0.0"`. Install/maintain `dsh` under Node 22 so
the CLI matches the server and plugin engine requirements:

```sh
nvm install 22.23.2
/Users/parth.gupta/.nvm/versions/node/v22.23.2/bin/npm install -g @deepseek-ai/dsh@0.1.5-rc.2
```

Keep `dsh` and the server on the **same** Node major; a mismatch shows up as
`ERR_SQLITE_ERROR` / store failures from pnpm during `dsh plugin` commands.

### Installed plugins (live `web` profile)

| Plugin | Version | What it does |
|--------|---------|--------------|
| `@deepseek-ai/dsh-client-session-quick-switch` | local link | Cmd/Ctrl+K fuzzy Session switcher (this repo's own client plugin) |
| `dsh-cursor-subscription` | 0.6.6 | Use a Cursor subscription's models from the dsh model picker |
| `dsh-task-worktree` | 0.4.2 | Isolated git worktree per task |
| `dsh-approval-hotkeys` | 0.1.6 | `Enter` approve / `Esc` reject |

Install the community plugins with the **Node 22** CLI:

```sh
export PATH=/Users/parth.gupta/.nvm/versions/node/v22.23.2/bin:$PATH
dsh plugin --profile web add dsh-cursor-subscription
dsh plugin --profile web add dsh-task-worktree
dsh plugin --profile web add dsh-approval-hotkeys
bash personal/sync.sh pull                 # capture the rewritten manifest in the replica
```

**Peer-dependency warnings are expected.** The profile sets
`autoInstallPeers: false` deliberately: these plugins declare the harness's own
`@deepseek-ai/*` packages as peers, and Cordis injects them at runtime. `pnpm
peers check` reports them all as "missing" on a healthy install — not a defect.

**`minimumReleaseAge`:** pnpm 11 refuses versions published within 24 hours.
`pnpm-workspace.yaml` lists `dsh-cursor-subscription` under
`minimumReleaseAgeExclude` so a plain `add` takes the latest release rather than
silently selecting a stale one.

### Cursor subscription plugin — sign-in

1. Restart the `web` profile (bundle membership is read at startup).
2. In the Web UI: **Settings → Cursor Subscription**.
3. Click **Browser Sign-in** and finish the Cursor authorization in the browser
   (the page polls for ~2.5 minutes).
4. Pick a Cursor model (e.g. `composer-2`) in the model picker.

Caveats worth recording:

- It integrates Cursor's **unpublished** `agent.v1.AgentService/Run` protocol —
  a community reverse-engineering project (author `orrinzeng`, MIT, not
  affiliated with Anysphere). It can break when Cursor changes the server side.
- Tool calls still run through dsh's local toolset; Cursor's filesystem tools
  are never used. The Cursor side supplies **only the model**.
- Credentials land in dsh's local credential store (`~/.dsh/.credentials.yaml`),
  which is already mode `600` — keep it out of the repo.


## Replica layout

| Replica here | Live target |
|--------------|-------------|
| `profile/package.json` | `~/.dsh/profiles/web/package.json` |
| `profile/cordis.patch.yml` | `~/.dsh/profiles/web/cordis.patch.yml` |
| `profile/pnpm-workspace.yaml` | `~/.dsh/profiles/web/pnpm-workspace.yaml` |
| `profile/settings.yaml` | `~/.dsh/settings.yaml` |
| `packages/client/<name>/` | installed into the profile via `dsh plugin add` |

## Install the harness

```sh
# one-off (no global install)
npx @deepseek-ai/dsh web

# or install the CLI globally
npm i -g @deepseek-ai/dsh
dsh web
```

A fresh `web` profile auto-initializes from the shipped template on first use
(base + web-app, live patches). Config lives under `$DSH_HOME` (`~/.dsh`).

## How the config layers compose

Later layers win. For profile `web`:

1. bundle patches — `@deepseek-ai/dsh-base`, then `@deepseek-ai/dsh-web-app`
2. the profile's own `~/.dsh/profiles/web/cordis.patch.yml`
3. the home-level `~/.dsh/cordis.patch.yml` (machine-local, outranks the profile)
4. each `--patch <file>` overlay passed on the command line, in order

A patch **replaces** the targeted row's whole `config` value (no deep merge)
and may insert new rows. **Edit `cordis.patch.yml`, never `cordis.yml`** —
`cordis.yml` is the composed, generated root.

Inspect the composed tree without booting:

```sh
dsh --profile web --dump-default-config   # bundles only
dsh --profile web --dump-config           # + patch layers
```

## Plugins

A `dsh` plugin is a TypeScript/JavaScript module exporting an `apply(ctx)` function.
Nothing here edits the harness source — plugins are additive.

There are **two classes** of plugin, and they build very differently:

| Class | Ships | Build | Where it can live |
|-------|-------|-------|-------------------|
| **Host-only** | plain `index.js` bundle | none | anywhere (this repo) |
| **Client (UI)** | `lib/client.js` browser bundle | `tsdown` via the monorepo preset | **only inside a harness checkout** |

The client build preset `packages/client/tsdown.client.ts` locates a package by
scanning `packages/*/*/package.json`, so a UI plugin cannot be built standalone —
it must live inside a checkout's `packages/client/`. This repo is that checkout,
which is why it is a fork: `master` stays a mirror of upstream, and our packages
ride a branch.

### Client (UI) plugins — build workflow

Verified end-to-end against `0.1.5-rc.2`. Requirements: **Node 22.19+/24**
(we use nvm `22.23.2`) and corepack pnpm `11.7.0`.

```sh
# 1. the checkout (this repo)
cd ~/deepseek-harness
git switch feat/session-quick-switch

# 2. Node + pnpm
nvm use 22.23.2 && corepack enable && corepack prepare pnpm@11.7.0 --activate

# 3. install + build (the host pass generates the /remote declarations
#    the client types need)
pnpm install
pnpm run build:lib:host
pnpm run build:lib:client

# 4. install into the profile + restart
dsh plugin --profile web add link:~/deepseek-harness/packages/client/session-quick-switch
dsh web
```

Notes / gotchas:

- **The build wiring is committed.** `tsconfig.client.json` registers the package
  in the Client aggregate and `pnpm-lock.yaml` carries its importer. Both are
  upstream-maintained files, so expect conflicts when rebasing onto newer
  upstream.
- **Installed packages must not use `workspace:^`.** The monorepo build needs it,
  but `dsh plugin add` runs a standalone pnpm install, so `peerDependencies` use a
  real range (`@deepseek-ai/cordis: ^4.0.2`). `devDependencies` stay `workspace:^`
  (ignored at install).
- Client bundles hot-reload through the client-plugin HMR receiver; bundle
  membership changes still need a restart.
- `dsh plugin add` writes an **absolute `link:` path** into the profile manifest
  (machine-specific). The replica records it; on a new machine re-run step 4.

### Starter plugin: session quick-switch

`packages/client/session-quick-switch/` — a Cmd/Ctrl+K fuzzy Session switcher
(`shell.overlay` UI + `useSessions` catalog + `ctx.uiWorkspace.openSession`).
See its README. It is a **client** plugin, so it needs the checkout build above.

### Plugin package layout (a "bundle")

Each plugin is an npm package that ships a config layer. Host-only plugins may
live anywhere; client plugins must live under `packages/client/<name>/`:

```
plugins/<name>/
├── package.json       # declares dsh.bundle -> ./cordis.patch.yml
├── cordis.patch.yml   # the layer: inserts this plugin's rows
└── index.js           # export const name; export function apply(ctx, config)
```

`package.json`:

```json
{
  "name": "dsh-<name>",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` (reference the package by name so Node resolution finds it):

```yaml
- insert:
    - id: <name>
      name: dsh-<name>
```

`index.js`:

```js
export const name = 'dsh-<name>'

export function apply(ctx, config) {
  // Register tools/hooks/UI via ctx. Registrations self-clean on unload.
}
```

A plugin may export a `Config` Schemastery schema; its defaults and validation
run at load. Anything two deployments might set differently must be a config
field, not a hard-coded constant.

### Install a plugin into the profile

```sh
# from the repo root; relative specs are anchored to the invoking directory
dsh plugin --profile web add link:./packages/client/<name>
```

`link:` symlinks the checkout so local edits are picked up. A built tarball or
local checkout needs no pnpm `allowBuilds` allowance. Then **restart the profile**:
bundle membership is read at startup.

### Dev loop

- Editing `~/.dsh/profiles/web/cordis.patch.yml` or a plugin's `cordis.patch.yml`
  **hot-reloads** (config edits are live; the old plugin instance is unloaded and
  a new one loaded, and `ctx.effect()` disposers run).
- **Adding/removing/updating a bundle requires a restart.**
- For rapid `.ts` iteration with true HMR, run from a source checkout:
  `git clone … && pnpm install && pnpm run build && pnpm dsh web --patch ./overlay.yml`,
  where the overlay's plugin `name` is an **absolute path** to the `.ts` file.

## Wire-up / sync

`profile/` files here are replicas. Use the sync script:

```sh
bash personal/sync.sh push   # repo  -> live (~/.dsh)
bash personal/sync.sh pull   # live  -> repo (after `dsh plugin add` mutates the manifest)
```

`dsh plugin add` rewrites the live `package.json` (dependencies + bundle list);
run `pull` afterwards to capture that change in the replica.

## Verify

```sh
dsh --profile web --dump-config          # tree composes, no unmatched-target errors
dsh web --no-open                        # boot; watch for plugin load lines
curl -sI http://127.0.0.1:3080 | head -1 # expect 200
```

## Caveats

- **Developer preview**: the plugin API is unstable — "there WILL be
  compatibility-breaking changes." Pin the harness version your plugins target
  and treat upgrades as a deliberate step (re-run the dev loop, fix any
  `inject`/extension-point changes).
- **Fork scope.** The fork exists to carry plugins and profile config, not to
  patch the harness. Reach for an extension point first; if core behavior is
  genuinely unreachable, change it on a branch and upstream it.
