/** Where the meal the modal opens on is remembered between visits. */
const STORAGE_KEY = 'calorie-app:last-meal'

/**
 * The meal the log modal starts on.
 *
 * Logging is no longer entered from inside a meal — one button opens the modal
 * and the meal is picked in it — so the modal has to guess which meal is meant,
 * and the best guess is the last one used. That is a habit rather than a
 * setting: someone logging a snack at four picks the snack row once, and every
 * row after it lands there without being told to again.
 *
 * Read straight out of storage rather than kept in shared state: the modal is
 * mounted by a tap and only ever exists in the browser, so there is no server
 * render for a stored value to disagree with, and reading it as the modal is
 * built means the right row is selected on the first frame.
 */
export function useLastMeal() {
  /** The meal last logged into, or null when there is nothing remembered. */
  function read(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      // A browser refusing storage outright. The modal falls back to the first
      // meal, which is where it would have started anyway.
      return null
    }
  }

  function remember(mealId: string | null) {
    try {
      if (mealId === null) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, mealId)
    } catch {
      // Out of quota, or private mode. The choice still holds while the app is
      // open; it just does not survive the tab.
    }
  }

  return { read, remember }
}
