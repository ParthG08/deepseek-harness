/**
 * Session quick-switch overlay: a query box over the non-blank, non-subagent
 * Session catalog, fuzzy-filtered by display title. Arrow keys move the
 * highlight, Enter opens the highlighted Session, Esc dismisses. Reads the
 * catalog through the framework `useSessions` seat and navigates through the
 * injected `open` callback; owns no transport and no subscription.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `shell.overlay` SlotMap declaration and the `useSessions` seat.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fuzzyMatch } from './fuzzy.ts'
import type { QuickSwitchStore } from './store.ts'
import css from './QuickSwitch.module.css'

/** Registration-side capability the overlay closes over. */
export interface QuickSwitchInjected {
  /**
   * Open one Session in the main view.
   * @param sessionId - Session to display.
   */
  open: (sessionId: SessionId) => void
}

/** Full component props assembled by the slot renderer. */
export type QuickSwitchProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<QuickSwitchStore>
  & PropsLocale<'sessionQuickSwitch'>
  & InjectFace<QuickSwitchInjected>

/** One rendered row. */
interface Row {
  id: SessionId
  title: string
}

/** Maximum rows shown at once. */
const RESULT_LIMIT = 50

/**
 * Render the quick-switch overlay (nothing while closed).
 * @param props - composed slot props (see {@link QuickSwitchProps}).
 * @returns the overlay element tree, or null when closed.
 */
export function QuickSwitch(props: QuickSwitchProps): ReactNode {
  const { t, useStore, actions, open, useSessions } = props
  const openState = useStore(state => state.open)
  const query = useStore(state => state.query)
  const highlight = useStore(state => state.highlight)
  const sessions = useSessions(state => state)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (openState) inputRef.current?.focus()
  }, [openState])

  const rows = useMemo<Row[]>(() => {
    const candidates = sessions.ids.flatMap((id) => {
      const summary = sessions.byId[id]
      if (summary === undefined || summary.origin === 'subagent' || summary.blank) return []
      return [{ id: summary.id, title: summary.displayTitle, updatedAt: summary.updatedAt }]
    })

    const trimmed = query.trim()
    if (trimmed === '') {
      return candidates
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, RESULT_LIMIT)
        .map(({ id, title }) => ({ id, title }))
    }

    const scored: (Row & { score: number })[] = []
    for (const candidate of candidates) {
      const match = fuzzyMatch(trimmed, candidate.title)
      if (match !== null) scored.push({ id: candidate.id, title: candidate.title, score: match.score })
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, RESULT_LIMIT)
      .map(({ id, title }) => ({ id, title }))
  }, [sessions, query])

  if (!openState) return null

  const choose = (index: number): void => {
    const row = rows[index]
    if (row === undefined) return
    open(row.id)
    actions.hide()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      actions.hide()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      actions.setHighlight(Math.min(highlight + 1, rows.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      actions.setHighlight(Math.max(highlight - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(highlight)
    }
  }

  const onBackdrop = (_event: ReactMouseEvent<HTMLDivElement>): void => { actions.hide() }

  return (
    <div className={css.backdrop} role="presentation" onMouseDown={onBackdrop}>
      <div
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onMouseDown={event => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className={css.input}
          type="text"
          value={query}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          onChange={event => actions.setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {rows.length === 0
          ? <p className={css.empty}>{t('noMatch')}</p>
          : (
            <ul className={css.list} role="listbox" aria-label={t('title')}>
              {rows.map((row, index) => (
                <li
                  key={row.id}
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? `${css.row} ${css.selected}` : css.row}
                  onMouseEnter={() => actions.setHighlight(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(index)
                  }}
                >
                  {row.title}
                </li>
              ))}
            </ul>
          )}
        <p className={css.hint}>{t('hint')}</p>
      </div>
    </div>
  )
}
