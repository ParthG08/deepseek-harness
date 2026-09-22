# @deepseek-ai/dsh-client-session-quick-switch

A dsh Web-client plugin: press **Cmd/Ctrl+K**, type to fuzzy-search your
Sessions by title, and press **Enter** to switch to the highlighted one.

This is a **client (browser-half) plugin** — it adds a UI surface, so it uses the
client bundle build pipeline rather than a plain `index.js` host bundle.

## What it registers

| Piece | Extension point |
|-------|-----------------|
| Overlay UI | `shell.overlay` (frame-wide floating layer, declared by `ui-layout`) |
| Global shortcut | `window` `keydown` for Cmd/Ctrl+K, toggling the overlay store |
| Session catalog | framework `useSessions` seat (no transport owned here) |
| Navigation | injected `ctx.uiWorkspace.openSession(sessionId)` |

## Layout

```
package.json                 # dsh.bundle + dsh.client, deps, build scripts
cordis.patch.yml             # bundle layer: inserts this plugin's Host row
tsdown.config.ts             # uses ../tsdown.client.ts (MONOREPO-RELATIVE)
tsconfig.json
src/index.ts                 # Host half (empty; browser-only plugin)
src/client/index.ts          # browser half: locale, slot inject, shortcut
src/client/QuickSwitch.tsx   # the overlay component
src/client/store.ts          # shared open/query/highlight view state
src/client/fuzzy.ts          # dependency-free subsequence matcher
src/client/locales.ts        # en + zh dictionaries
src/client/QuickSwitch.module.css
```

## Build

The client build preset `packages/client/tsdown.client.ts` resolves packages by
scanning `packages/*/*/package.json`, so this package builds only inside the
harness checkout it lives in:

```sh
# from the repo root
git switch feat/session-quick-switch
corepack enable
pnpm install
pnpm run build          # or: pnpm --filter @deepseek-ai/dsh-client-session-quick-switch bundle
```

The build emits `lib/index.js`, `lib/client.js`, and `lib/types/**`.

## Install into the profile

```sh
dsh plugin --profile web add link:<checkout>/packages/client/session-quick-switch
# restart the web profile
dsh web
```

## Dev loop

- `pnpm --filter @deepseek-ai/dsh-client-session-quick-switch watch` rebuilds the client
  bundle; the client-plugin HMR receiver picks it up without a restart.
- Editing `cordis.patch.yml` or the profile patch hot-reloads.
- Adding/removing the bundle requires a profile restart.

## Status

**Built and installed.** The live `web` profile manifest
(`~/.dsh/profiles/web/package.json`) lists this package in `dsh.profile.bundles`,
so it is compiled and loaded by the running harness.

Still to verify: a manual pass over the Cmd/Ctrl+K overlay in the live UI. APIs
are taken from the harness source at the recorded version (`0.1.5-rc.2` line). If
the purity gate rejects an import on a future rebuild, declare it under
`dsh.client.external`.

### Related

- [personal/setup.md](../../../personal/setup.md) — build workflow, dev loop, and
  profile sync rules.
