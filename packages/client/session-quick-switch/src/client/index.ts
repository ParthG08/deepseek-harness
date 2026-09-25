/**
 * Session quick-switch, browser half. Contributes one `shell.overlay` entry
 * (the frame-wide floating layer) with a global Cmd/Ctrl+K shortcut that toggles
 * it, plus the sidebar shortcuts Cmd/Ctrl+B (left column) and Cmd/Ctrl+L (right
 * Sidebar). Navigation goes through `ctx.uiWorkspace.openSession`; the Session
 * catalog is read by the component through the framework `useSessions` seat, so
 * this plugin owns no transport and no subscription of its own.
 *
 * Cmd/Ctrl+L is a browser-reserved accelerator, so that handler only sees the
 * key where the browser does not claim it: an installed PWA window, which has no
 * address bar, or a document holding JavaScript-initiated fullscreen, where the
 * Keyboard Lock API releases KeyL. The lock is requested on entering fullscreen
 * and released on leaving it, so the key returns to the browser afterward.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `shell.overlay` SlotMap declaration and the `layout` Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `sidebarRight` Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
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

/** Services required by the overlay, the navigation callback, and the sidebar shortcuts. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'layout', 'sidebarRight']

/** The key code the Keyboard Lock API must release for the right-column shortcut. */
const LOCKED_CODES = ['KeyL']

/**
 * The Keyboard Lock surface. Absent from the DOM library, and present only in
 * Chromium, where it remains experimental.
 */
interface KeyboardLock {
  /**
   * Release keys from the browser to this document.
   * @param codes - the key codes to release; every key when omitted.
   * @returns a promise that rejects when the browser denies the request.
   */
  lock(codes?: readonly string[]): Promise<void>
  /** Release every key this document locked. */
  unlock(): void
}

/**
 * Read the Keyboard Lock surface.
 * @returns the surface, or `undefined` where the browser does not expose one.
 */
function keyboardLock(): KeyboardLock | undefined {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
  return keyboard !== undefined && typeof keyboard.lock === 'function' ? keyboard : undefined
}

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

  /** Hold KeyL while this document is fullscreen, and hand it back when it leaves. */
  const lockWhileFullscreen = (): void => {
    const keyboard = keyboardLock()
    if (keyboard === undefined) return
    if (document.fullscreenElement === null) {
      keyboard.unlock()
      return
    }
    void keyboard.lock(LOCKED_CODES).catch(() => {
      // The browser denied the request: Chrome gates it behind a permission,
      // and user-initiated fullscreen (F11, Ctrl+Cmd+F) is never eligible.
      // Cmd/Ctrl+L then stays with the browser rather than reaching this page.
    })
  }

  /** Toggle a sidebar column; a key the browser kept never reaches this handler. */
  const onSidebarKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat) return
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    const key = event.key.toLowerCase()
    if (key === 'b') {
      event.preventDefault()
      ctx.layout.toggleSidebar()
      return
    }
    if (key !== 'l') return
    // A write has no Session to act on before a surface is mounted, and the
    // service throws there by design; the shortcut stays inert instead.
    if (ctx.sidebarRight.active() === undefined) return
    event.preventDefault()
    ctx.sidebarRight.toggleExpanded()
  }

  ctx.effect(() => {
    window.addEventListener('keydown', onSidebarKeyDown)
    document.addEventListener('fullscreenchange', lockWhileFullscreen)
    lockWhileFullscreen()
    return () => {
      window.removeEventListener('keydown', onSidebarKeyDown)
      document.removeEventListener('fullscreenchange', lockWhileFullscreen)
      keyboardLock()?.unlock()
    }
  }, 'session-quick-switch: sidebar shortcuts and fullscreen keyboard lock')
}
