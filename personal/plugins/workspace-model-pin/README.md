# dsh-workspace-model-pin

Pin each session's **model provider family** by its working directory.

DeepSeek Harness routes every session through one process-wide default model
(`dsh-agent-default-model`), and the per-session selection is owned by the API
Session. There is no per-workspace model configuration. This plugin adds that
axis: a session whose `cwd` matches a rule may only use the providers that rule
allows.

The motivating case: one harness process, two repos with opposite rules — a
learning repo that must stay **DeepSeek-only**, and a work repo that must stay
**Cursor-only**.

## Semantics

- A rule matches a session by **longest path prefix** (boundary-aware, so
  `/a/bc` never matches the rule `/a/b`).
- Any model whose **provider** is in the rule's `providers` list passes through
  untouched — so *every* model in that family stays selectable.
- A request from a provider that is **not** allowed is rewritten to the rule's
  `default` route.
- A session matching **no rule** is left completely alone (`cwd` outside every
  prefix, and headless/other entry points).

Pinning happens through two independent mechanisms:

1. **Session start** — the Session-local selection is set through the API
   Session controller, so the model picker, the durable `model/selection` event,
   and the request header all agree. Preferred, because the rest of the
   selection machinery stays consistent.
2. **Every request** — the route is rewritten at the `agent/request` waterfall
   with `{ prepend: true }`, making it the outermost listener. This is the
   unconditional guarantee: it survives an upstream rename of the internal
   members used by (1), and it also catches a mid-session picker change to a
   disallowed provider.

A one-line `notice` context is injected at most once per session the first time
a route is repinned.

## Configuration

The row is inserted with no config by the bundle layer. Rules belong in the
**profile patch** because they carry absolute machine paths
(`~/.dsh/profiles/web/cordis.patch.yml`, replicated at
`personal/profile/cordis.patch.yml`):

```yaml
- id: workspace-model-pin
  config:
    rules:
      - match: /Users/me/repos/learn
        providers: [deepseek-official]
        default:
          provider: deepseek-official
          model: deepseek-v4-flash
          reasoningEffort: high
      - match: /Users/me/Desktop/Khatabook
        providers: [cursor-subscription]
        default:
          provider: cursor-subscription
          model: composer-2.5
    notice: true
    useSessionController: true
```

| Field | Default | Meaning |
|---|---|---|
| `rules[].match` | — | Absolute directory prefix that selects the rule. Required. |
| `rules[].providers` | — | Allowed provider routes. Required, non-empty. |
| `rules[].default` | — | `{ provider, model, reasoningEffort? }` used when the current provider is not allowed. Required. |
| `notice` | `true` | Inject the one-line repin notice. |
| `useSessionController` | `true` | Use mechanism (1). Set `false` to leave the Session-local selection untouched and rely only on the request rewrite. |

A rule missing `match`, `providers`, `provider`, or `model` is dropped at load;
with no usable rules the plugin logs `no rules configured — plugin is inert` and
does nothing.

Provider ids in use here: `deepseek-official` (the DeepSeek route) and
`cursor-subscription` (the Cursor subscription route). Run
`node personal/scripts/list-cursor-models.mjs` to see the Cursor model ids the
signed-in account can actually use.

## Install

```sh
export PATH=/Users/parth.gupta/.nvm/versions/node/v22.23.2/bin:$PATH
dsh plugin --profile web add link:~/deepseek-harness/personal/plugins/workspace-model-pin
bash personal/sync.sh pull          # capture the rewritten manifest in the replica
```

**A restart is required** — bundle membership is read at startup. Config-only
edits to the rules hot-reload.

## Verify

```sh
dsh --profile web --dump-config     # expect exactly one workspace-model-pin row with your rules
```

Then, from a pinned workspace, confirm the effective model in the picker matches
the rule, and check the log for `workspace-model-pin:` lines.

## Notes

- The plugin imports **no** harness package. A host-only plugin installed by
  `link:` resolves modules through the profile, where `@deepseek-ai/*` packages
  are injected as Cordis services rather than importable; the one message helper
  it needs is reimplemented locally.
- Internal members used by mechanism (1) — `sessionController.agents.selectionFor`
  and `.selectForNextRequest` — are TypeScript-private but runtime-stable on the
  pinned harness version. Mechanism (2) needs none of them, so an upstream
  rename degrades the plugin to request-level pinning instead of breaking it.
- Treat the rules as trusted configuration: they decide which provider pays for
  a workspace's requests.
