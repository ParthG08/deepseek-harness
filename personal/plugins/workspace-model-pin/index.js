/**
 * dsh-workspace-model-pin — hold each session's model requests to the provider
 * family its working directory allows.
 *
 * DeepSeek Harness has no per-workspace model configuration: the default route
 * is process-wide (`dsh-agent-default-model`) and the Session-local selection is
 * owned by the API Session. This plugin supplies the missing axis. It reads each
 * session's `cwd` and pins its requests to the provider family that workspace
 * allows, so a learning repo can be DeepSeek-only while a work repo is
 * Cursor-only, in the same harness process.
 *
 * Rules are configuration, because they carry absolute machine paths:
 *
 *   - id: workspace-model-pin
 *     config:
 *       rules:
 *         - match: /Users/me/repos/learn
 *           providers: [deepseek-official]
 *           default: { provider: deepseek-official, model: deepseek-v4-flash }
 *         - match: /Users/me/Desktop/Khatabook
 *           providers: [cursor-subscription]
 *           default: { provider: cursor-subscription, model: composer-2.5 }
 *
 * Semantics: any model whose provider is listed passes through untouched, so
 * every model in that family stays selectable; a disallowed provider is
 * rewritten to the rule's `default` route. A session whose `cwd` matches no rule
 * is left completely alone. When rules overlap, the longest matching prefix
 * wins.
 *
 * Two independent mechanisms, strongest first:
 *
 *   1. At session start the Session-local selection is set through the API
 *      Session controller, so the model picker, the durable `model/selection`
 *      event, and the request header all agree. This is preferred because it
 *      leaves the rest of the selection machinery consistent.
 *   2. Every outgoing request is rewritten at the `agent/request` waterfall.
 *      This is the unconditional guarantee: it holds even when (1) is
 *      unavailable (headless composition, upstream rename), and even when the
 *      model picker is changed to a disallowed provider mid-session.
 *
 * @module dsh-workspace-model-pin
 */

import { randomUUID } from 'node:crypto'

/** Plugin display name; the profile patch row also carries an `id`. */
export const name = 'dsh-workspace-model-pin'

/** Plugin id reported in injected notices. */
const PLUGIN = 'dsh-workspace-model-pin'

/** `summary` rides a collapsed transcript row; the message layer bounds it there too. */
const SUMMARY_MAX_CHARS = 120

/**
 * Normalize one path for prefix comparison: forward slashes, no trailing
 * separator (except a bare root).
 * @param value - raw path.
 * @returns the comparable form.
 */
function normalizePath(value) {
  const slashed = value.replaceAll('\\', '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

/**
 * Test whether a session directory sits inside a rule prefix, at a path
 * boundary (so `/a/bc` does not match the rule `/a/b`).
 * @param cwd - the session's working directory.
 * @param prefix - the normalized rule prefix.
 * @returns whether the directory is the prefix or lives beneath it.
 */
function isUnder(cwd, prefix) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  const dir = normalizePath(cwd)
  if (dir === prefix) return true
  return prefix === '/' ? dir.startsWith('/') : dir.startsWith(`${prefix}/`)
}

/**
 * Validate and normalize one configured rule.
 * @param raw - one entry of the `rules` array.
 * @returns the usable rule, or `undefined` when a required field is missing.
 */
function normalizeRule(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const match = typeof raw.match === 'string' && raw.match.length > 0
    ? normalizePath(raw.match)
    : undefined
  const providers = Array.isArray(raw.providers)
    ? raw.providers.filter(provider => typeof provider === 'string' && provider.length > 0)
    : []
  const fallback = raw.default
  const provider = typeof fallback?.provider === 'string' ? fallback.provider : undefined
  const model = typeof fallback?.model === 'string' ? fallback.model : undefined
  if (match === undefined || providers.length === 0 || provider === undefined || model === undefined) {
    return undefined
  }
  return {
    match,
    providers,
    provider,
    model,
    ...(typeof fallback.reasoningEffort === 'string'
      ? { reasoningEffort: fallback.reasoningEffort }
      : {}),
  }
}

/**
 * Normalize the plugin config, dropping rules that could never match.
 * @param config - raw composition config.
 * @returns the usable settings.
 */
function normalizeConfig(config) {
  const raw = config ?? {}
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(normalizeRule).filter(rule => rule !== undefined)
    : []
  return {
    rules,
    notice: raw.notice !== false,
    useSessionController: raw.useSessionController !== false,
  }
}

/**
 * Select the rule governing one directory: the longest matching prefix.
 * @param rules - normalized rules in declaration order.
 * @param cwd - the session's working directory.
 * @returns the winning rule, or `undefined` when the directory is unpinned.
 */
function ruleFor(rules, cwd) {
  let best
  for (const rule of rules) {
    if (!isUnder(cwd, rule.match)) continue
    if (best === undefined || rule.match.length > best.match.length) best = rule
  }
  return best
}

/**
 * Build the route a rule pins to.
 * @param rule - the winning rule.
 * @returns a provider/model/effort selection.
 */
function pinnedRoute(rule) {
  return {
    provider: rule.provider,
    model: rule.model,
    ...(rule.reasoningEffort === undefined ? {} : { reasoningEffort: rule.reasoningEffort }),
  }
}

/**
 * Label a route relative to another, mirroring the harness's own model-change
 * notice (bare model id when the provider is unchanged).
 * @param route - route to label.
 * @param other - route being compared against.
 * @returns the short label.
 */
function routeLabel(route, other) {
  return route.provider === other.provider ? route.model : `${route.provider}/${route.model}`
}

/**
 * Deep-freeze a value in place, matching how the message layer publishes
 * context. Defined locally so the plugin imports no harness package: a
 * host-only plugin installed by `link:` resolves modules through the profile,
 * where the harness's own packages are injected as services rather than
 * importable.
 * @param value - value to freeze.
 * @returns the same value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

/**
 * Build the one-line notice injected when a request is repinned.
 * @param from - route the session would otherwise have used.
 * @param to - route the workspace pins it to.
 * @returns a user-role plugin notice message.
 */
function pinNotice(from, to) {
  const fromLabel = routeLabel(from, to)
  const toLabel = routeLabel(to, from)
  const summary = `pinned ${fromLabel} → ${toLabel}`.slice(0, SUMMARY_MAX_CHARS)
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: `[workspace model pin: this workspace pins the ${to.provider} provider, `
        + `so the request was routed from ${fromLabel} to ${toLabel}]`,
    }],
    source: { kind: 'plugin', plugin: PLUGIN, form: 'notice', summary },
  })
}

/**
 * Read a Cordis service without failing when it is absent.
 * @param ctx - host context.
 * @param key - service name.
 * @returns the service, or `undefined`.
 */
function readService(ctx, key) {
  try {
    return ctx.get(key)
  } catch {
    return undefined
  }
}

/**
 * Install the workspace model pin.
 * @param ctx - host context.
 * @param config - composition config carrying `rules`.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)

  if (settings.rules.length === 0) {
    ctx.logger?.info?.('workspace-model-pin: no rules configured — plugin is inert')
    return
  }

  /** Sessions already told about a repin. Weak keys keep no session alive. */
  const announced = new WeakMap()

  /**
   * Report a repin at most once per session.
   * @param session - the session owning the notice.
   * @returns whether this call is the first for that session.
   */
  function shouldAnnounce(session) {
    if (session === undefined || session === null) return false
    if (announced.has(session)) return false
    announced.set(session, true)
    return true
  }

  /** Log without letting a logger failure disturb request routing. */
  function note(message) {
    try {
      ctx.logger?.info?.(`workspace-model-pin: ${message}`)
    } catch {
      /* logging must never affect routing */
    }
  }

  // ---- (1) preferred: pin the Session-local selection at session start ----
  //
  // The API Session owns the live selection and the durable `model/selection`
  // event. Setting it here keeps the picker, the projection, and the request
  // header in agreement, which is why this runs first. It touches only the two
  // runtime members it needs; anything missing falls through to (2).
  ctx.on('agent/session-start', ({ agent }) => {
    if (!settings.useSessionController) return
    const rule = ruleFor(settings.rules, agent?.session?.header?.cwd)
    if (rule === undefined) return

    try {
      const controller = readService(ctx, 'sessionController')
      const agents = controller?.agents
      if (typeof agents?.selectForNextRequest !== 'function') return

      const current = typeof agents.selectionFor === 'function'
        ? agents.selectionFor(agent)?.current
        : undefined
      // An already-allowed family is left exactly as the user chose it.
      if (current !== undefined && rule.providers.includes(current.provider)) return

      const to = pinnedRoute(rule)
      agents.selectForNextRequest(agent, to)
      note(`session ${String(agent.id)} on ${rule.match}: selection set to ${routeLabel(to, to)}`)
      if (settings.notice && current !== undefined && shouldAnnounce(agent.session)) {
        agent.inject(pinNotice(current, to))
      }
    } catch (error) {
      // The request-level pin below still guarantees the rule.
      note(`could not set the Session model selection: ${String(error)}`)
    }
  })

  // ---- (2) guarantee: rewrite every outgoing request ----
  //
  // `prepend` makes this the outermost waterfall listener, so it applies its
  // route after every other listener (including the API Session's own
  // selection) has had its say.
  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    const rule = ruleFor(settings.rules, agent?.session?.header?.cwd)
    if (rule === undefined) return resolved
    if (rule.providers.includes(resolved.provider)) return resolved

    const to = pinnedRoute(rule)
    // The incoming effort belongs to the outgoing provider's route, so it is
    // dropped unless the rule names one — mirroring the harness's own
    // selection override.
    const { reasoningEffort: _inherited, ...withoutEffort } = resolved
    const pinned = { ...withoutEffort, ...to }

    note(`session ${String(agent.id)} on ${rule.match}: routed ${routeLabel(resolved, to)} to ${routeLabel(to, resolved)}`)
    if (settings.notice && shouldAnnounce(agent.session)) {
      agent.inject(pinNotice(resolved, to))
    }
    return pinned
  }, { prepend: true })
}
