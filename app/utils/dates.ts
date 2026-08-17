/**
 * Dates are plain YYYY-MM-DD strings resolved in the user's own timezone.
 *
 * The server never decides what "today" is — a day boundary at 3am local time
 * would otherwise file a late dinner under tomorrow.
 */
export function toIsoDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function todayIso(): string {
  return toIsoDate(new Date())
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  // Constructed at noon so a DST shift cannot move the result to a neighbouring day.
  const date = new Date(y!, m! - 1, d!, 12)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!, 12)
  const today = todayIso()

  if (iso === today) return 'Today'
  if (iso === shiftIsoDate(today, -1)) return 'Yesterday'
  if (iso === shiftIsoDate(today, 1)) return 'Tomorrow'

  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
