/** Copy dictionaries for the Session quick-switch overlay. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  title: '切换会话',
  placeholder: '输入以搜索会话…',
  noMatch: '没有匹配的会话。',
  hint: '↑↓ 选择 · Enter 打开 · Esc 关闭',
} satisfies Record<string, string>

/** Quick-switch locale key union. */
export type QuickSwitchLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  title: 'Switch session',
  placeholder: 'Type to search sessions…',
  noMatch: 'No matching sessions.',
  hint: '↑↓ to move · Enter to open · Esc to close',
} satisfies Record<QuickSwitchLocaleKey, string>
