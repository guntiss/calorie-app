/** Where the folded sections are remembered between visits. */
const STORAGE_KEY = 'calorie-app:collapsed-meals'

/**
 * What a section is remembered under.
 *
 * Meal ids are per user and stable across days, so the fold belongs to the
 * meal rather than to the day it was folded on — open yesterday and breakfast
 * is folded there too. The catch-all section has no meal behind it, so it
 * takes a name of its own.
 */
function keyOf(mealId: string | null) {
  return mealId ?? 'unsorted'
}

/**
 * Which meal sections are folded shut.
 *
 * Shared through `useState` so every caller reads the one list, and written
 * out to `localStorage` on each change: a fold is a statement about how this
 * person eats — nothing before noon, say — not about this visit, and a
 * preference that has to be repeated every morning is not a preference.
 *
 * Restored on mount rather than while the store is built. The day itself only
 * ever loads in the browser, so the grid never renders on the server, but
 * reading storage during setup is what makes that a hydration mismatch the day
 * something else on the page changes.
 */
export function useMealCollapse() {
  const collapsed = useState<string[]>('meal-collapse', () => [])

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const list = JSON.parse(raw)
      if (Array.isArray(list)) collapsed.value = list.filter(id => typeof id === 'string')
    } catch {
      // Written by an older version of this, or half-written by a tab that was
      // closed mid-save. It is only a preference; drop it and start open.
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed.value))
    } catch {
      // Out of quota, or a browser in private mode that refuses to store at
      // all. The fold still works for as long as the app is open.
    }
  }

  if (import.meta.client) onMounted(restore)

  function isCollapsed(mealId: string | null) {
    return collapsed.value.includes(keyOf(mealId))
  }

  function toggle(mealId: string | null) {
    const key = keyOf(mealId)
    collapsed.value = isCollapsed(mealId)
      ? collapsed.value.filter(id => id !== key)
      : [...collapsed.value, key]
    persist()
  }

  /**
   * Open a section, if it is not already.
   *
   * For a row that has just been moved into a folded meal: the move has to be
   * visible where it landed, or it reads as the row having disappeared.
   */
  function expand(mealId: string | null) {
    if (isCollapsed(mealId)) toggle(mealId)
  }

  return { isCollapsed, toggle, expand }
}
