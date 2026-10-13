/** Where the meal the modal opens on is remembered between visits. */
const STORAGE_KEY = 'calorie-app:last-meal'

/** A meal picked by hand, and the part of which day it was picked in. */
interface Remembered {
  id: string
  /** The day and slot the pick was made in, as `slotKey` writes it. */
  slot: string
}

/**
 * The day and part of the day a moment falls in.
 *
 * A pick holds for as long as this stays the same: a snack picked at four is
 * still meant at half past, but not at dinner time, and not at four tomorrow.
 */
function slotKey(now: Date): string {
  return `${toIsoDate(now)} ${mealSlotAt(now)}`
}

/**
 * The meal the log modal starts on.
 *
 * Logging is no longer entered from inside a meal — one button opens the modal
 * and the meal is picked in it — so the modal has to guess which meal is meant.
 * The clock is the first guess: breakfast in the morning, lunch at midday. A
 * meal picked by hand overrides it for the rest of that part of the day, so
 * someone logging a late breakfast at noon picks the breakfast row once, and
 * every row after it lands there without being told to again.
 *
 * Read straight out of storage rather than kept in shared state: the modal is
 * mounted by a tap and only ever exists in the browser, so there is no server
 * render for a stored value to disagree with, and reading it as the modal is
 * built means the right row is selected on the first frame.
 */
export function useLastMeal() {
  function load(): Remembered | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<Remembered>
      return typeof parsed.id === 'string' && typeof parsed.slot === 'string'
        ? { id: parsed.id, slot: parsed.slot }
        : null
    } catch {
      // A browser refusing storage outright, or a bare id left by an older
      // version. Either way there is no pick to honour; the clock decides.
      return null
    }
  }

  /** The meal picked by hand, whenever it was. Null when there is none. */
  function read(): string | null {
    return load()?.id ?? null
  }

  /** The meal picked by hand in the current part of today, or null. */
  function readCurrent(now = new Date()): string | null {
    const remembered = load()
    return remembered && remembered.slot === slotKey(now) ? remembered.id : null
  }

  function remember(mealId: string | null, now = new Date()) {
    try {
      if (mealId === null) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: mealId, slot: slotKey(now) }))
    } catch {
      // Out of quota, or private mode. The choice still holds while the app is
      // open; it just does not survive the tab.
    }
  }

  return { read, readCurrent, remember }
}
