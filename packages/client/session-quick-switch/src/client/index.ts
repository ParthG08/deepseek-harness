/**
 * Session quick-switch, browser half. Contributes one `shell.overlay` entry
 * (the frame-wide floating layer) and a global Cmd/Ctrl+K shortcut that toggles
 * it. Navigation goes through `ctx.uiWorkspace.openSession`; the Session catalog
 * is read by the component through the framework `useSessions` seat, so this
 * plugin owns no transport and no subscription of its own.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `shell.overlay` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `useSessions` global standard prop.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the `uiWorkspace` Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { QuickSwitch } from './QuickSwitch.tsx'
import type { QuickSwitchInjected } from './QuickSwitch.tsx'
import { createQuickSwitchStore } from './store.ts'
import { en, zh, type QuickSwitchLocaleKey } from './locales.ts'

export type { QuickSwitchInjected, QuickSwitchProps } from './QuickSwitch.tsx'
export type { QuickSwitchLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Quick-switch overlay copy. */
    sessionQuickSwitch: QuickSwitchLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sessionQuickSwitch'

/** Services required by the overlay registration and the navigation callback. */
export const inject = ['slots', 'locale', 'uiWorkspace']

/**
 * Register the overlay and the global shortcut.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-quick-switch: dictionaries')

  ctx.slots.inject('shell.overlay', () => {
    const handle = createQuickSwitchStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      instance.actions.toggle()
    }
    window.addEventListener('keydown', onKeyDown)

    const disposeRegistration = ctx.slots.register({
      name: 'shell.overlay',
      id: 'session-quick-switch',
      order: 100,
      locale: NS,
      store,
      inject: (): QuickSwitchInjected => ({
        open: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
      }),
    }, QuickSwitch)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      disposeRegistration()
    }
  })
}
