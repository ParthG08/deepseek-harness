/**
 * Quick-switch overlay view state. A declared store is required because the
 * global shortcut (in `apply`) and the overlay component are separate entries
 * that must share one mutable fact.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Overlay view state. */
interface QuickSwitchState {
  /** Whether the overlay is shown. */
  open: boolean
  /** Current query text. */
  query: string
  /** Index of the highlighted row. */
  highlight: number
}

/** The complete mutation API for the overlay state. */
type QuickSwitchActions = {
  show: (draft: QuickSwitchState) => void
  hide: (draft: QuickSwitchState) => void
  toggle: (draft: QuickSwitchState) => void
  setQuery: (draft: QuickSwitchState, query: string) => void
  setHighlight: (draft: QuickSwitchState, index: number) => void
}

/** Store handle type the overlay component reads through `PropsStore`. */
export type QuickSwitchStore = EngineStoreHandle<QuickSwitchState, QuickSwitchActions>

/**
 * Create the quick-switch store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createQuickSwitchStore(): QuickSwitchStore {
  return defineStore({
    init: (): QuickSwitchState => ({ open: false, query: '', highlight: 0 }),
    actions: {
      show: (draft) => {
        draft.open = true
        draft.query = ''
        draft.highlight = 0
      },
      hide: (draft) => {
        draft.open = false
      },
      toggle: (draft) => {
        draft.open = !draft.open
        draft.query = ''
        draft.highlight = 0
      },
      setQuery: (draft, query) => {
        draft.query = query
        draft.highlight = 0
      },
      setHighlight: (draft, index) => {
        draft.highlight = index
      },
    },
  })
}
