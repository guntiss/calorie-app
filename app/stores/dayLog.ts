import { defineStore } from 'pinia'

/** How long a removed row is offered back before the deletion is sent. */
export const UNDO_WINDOW_MS = 6000

export interface DayFood extends Macros {
  id: string
  name: string
  brand: string | null
  /** What is printed on the packet, once someone has held a camera over it. */
  barcode: string | null
  /** How many logged rows name it, household-wide. Only the library asks. */
  logCount?: number
}

/**
 * A row in the grid.
 *
 * `id` is generated on the client so an optimistic row and its saved
 * counterpart are the same record — no reconciliation guesswork when the
 * server responds mid-typing.
 *
 * `foodId` is what makes a row a row: an entry is an amount of a food, and one
 * is only ever created with a food already chosen for it. The column is
 * nullable because the type mirrors the wire format, not because the grid ever
 * holds a row without one.
 */
export interface GridEntry {
  id: string
  mealId: string | null
  position: number
  foodId: string | null
  nameSnapshot: string
  quantity: number | null
  counted: boolean
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
}

/**
 * Where a row being dragged would land: against another row, on one side of it,
 * or — for a meal with nothing showing under its header — at the end of a meal.
 *
 * Said in terms of the row it sits against rather than an index, because that is
 * what the grid can see: the row under the finger, and which half of it. The
 * index it works out to is the store's business.
 */
export interface DropTarget {
  mealId: string | null
  entryId: string | null
  edge: 'before' | 'after'
}

interface DayResponse {
  date: string
  meals: Array<{ id: string, name: string, position: number }>
  entries: GridEntry[]
  goal: {
    kcal: number
    protein: number
    fat: number
    carbs: number
  } | null
}

export const useDayLogStore = defineStore('dayLog', () => {
  // The picker searches a copy of the library held on the device, so a food
  // written from here — created by logging a new name, corrected from a row —
  // has to land in that copy too, or the next search will not find what was
  // just typed.
  const library = useFoodLibraryStore()

  const date = ref(todayIso())
  const meals = ref<DayResponse['meals']>([])
  const entries = ref<GridEntry[]>([])
  const goal = ref<Macros>({ kcal: 0, protein: 0, fat: 0, carbs: 0 })

  /** Foods referenced by the grid, so quantity edits can be priced instantly. */
  const foodCache = ref(new Map<string, DayFood>())

  // Starts true so the server renders the same spinner the client shows before
  // its first load resolves — the day itself is only ever fetched client-side,
  // where the session cookie and the user's timezone both exist.
  const loading = ref(true)
  const saving = ref(false)
  const error = ref<string | null>(null)

  /** Rows edited since the last successful flush, and rows awaiting deletion. */
  const dirty = ref(new Set<string>())
  const pendingDeletes = ref(new Set<string>())

  /**
   * Rows taken off the grid whose undo window has not closed yet, held with
   * where they sat so undo puts them back in place. Not reactive: nothing
   * renders them, and the timers must not be proxied.
   */
  const removals = new Map<string, {
    entry: GridEntry
    index: number
    timer: ReturnType<typeof setTimeout>
  }>()

  let flushTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * The tail of the save queue.
   *
   * Saves run strictly one at a time. Two in flight together come back in
   * whatever order the network settles on, and the earlier response carries
   * exactly the values the later one was sent to replace — so adopting it
   * flicks every row in the newer batch back to its old weight until the
   * second response lands and corrects it.
   */
  let inFlight: Promise<void> = Promise.resolve()

  // --- derived ------------------------------------------------------------

  const totals = computed(() => dayTotals(entries.value.map(toTotalable)))

  /** What is left of the day's goal. */
  const remaining = computed(() => remainingMacros(goal.value, totals.value.total))

  const exceeded = computed(() => exceededMacros(goal.value, totals.value.total))

  const hasGoal = computed(() => goal.value.kcal > 0 || goal.value.protein > 0)

  const entriesByMeal = computed(() => {
    const grouped = new Map<string | null, GridEntry[]>()
    for (const meal of meals.value) grouped.set(meal.id, [])
    grouped.set(null, [])
    for (const entry of entries.value) {
      const key = grouped.has(entry.mealId) ? entry.mealId : null
      grouped.get(key)!.push(entry)
    }
    for (const list of grouped.values()) list.sort((a, b) => a.position - b.position)
    return grouped
  })

  /**
   * Whether a row still has no macros behind it, by the same rule the totals
   * use — so the marker on the row and the shortfall in the totals can never
   * disagree.
   *
   * It is the food that is missing its numbers, not the row: a food added while
   * logging starts with none, and says so on every row that names it until
   * someone types them in.
   */
  function isIncomplete(entry: GridEntry) {
    return Boolean(entry.foodId) && toTotalable(entry).macros === null
  }

  function toTotalable(entry: GridEntry): TotalableEntry {
    // A food added while logging starts with no numbers on it, which makes its
    // rows price out at zero. That is "not filled in yet", not "no calories",
    // so the day still reports itself as incomplete until someone types them.
    if (entry.foodId && isBlankFood(foodCache.value.get(entry.foodId))) {
      return { counted: entry.counted, macros: null }
    }

    const hasAny = entry.kcal !== null || entry.protein !== null
      || entry.fat !== null || entry.carbs !== null
    return {
      counted: entry.counted,
      macros: hasAny
        ? {
            kcal: entry.kcal ?? 0,
            protein: entry.protein ?? 0,
            fat: entry.fat ?? 0,
            carbs: entry.carbs ?? 0
          }
        : null
    }
  }

  // --- loading ------------------------------------------------------------

  /**
   * Fetch a day, replacing whatever is on the grid.
   *
   * `silent` keeps the day on screen while it refetches, for a reload of the
   * day already being looked at — swapping a grid the user is staring at for a
   * spinner and back is a worse answer than a moment of slightly stale numbers.
   */
  async function load(target: string = date.value, options: { silent?: boolean } = {}) {
    // Anything still in flight belongs to the day being left, and the fetch
    // below clears the queues it would otherwise be saved from.
    await flushNow()

    if (!options.silent) loading.value = true
    error.value = null
    try {
      const data = await $fetch<DayResponse>(`/api/log/${target}`)
      date.value = data.date
      meals.value = data.meals
      entries.value = data.entries
      goal.value = data.goal
        ? { kcal: data.goal.kcal, protein: data.goal.protein, fat: data.goal.fat, carbs: data.goal.carbs }
        : { kcal: 0, protein: 0, fat: 0, carbs: 0 }
      dirty.value.clear()
      pendingDeletes.value.clear()

      await cacheFoods(entries.value.map(e => e.foodId).filter((id): id is string => Boolean(id)))
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function cacheFoods(ids: string[]) {
    const missing = [...new Set(ids)].filter(id => !foodCache.value.has(id))
    if (!missing.length) return
    // The log modal already fetches foods; this is the cold-load path after a reload.
    const found = await $fetch<DayFood[]>('/api/foods', { query: { limit: 100 } })
    for (const food of found) foodCache.value.set(food.id, food)
  }

  function rememberFood(food: DayFood) {
    foodCache.value.set(food.id, food)
  }

  /** A food nobody has put numbers on yet. */
  function isBlankFood(food: DayFood | undefined) {
    return Boolean(food) && !food!.kcal && !food!.protein && !food!.fat && !food!.carbs
  }

  // --- editing ------------------------------------------------------------

  function nextPosition(mealId: string | null) {
    const siblings = entries.value.filter(e => e.mealId === mealId)
    return siblings.length ? Math.max(...siblings.map(e => e.position)) + 1 : 0
  }

  /**
   * Put a row on the grid.
   *
   * Every row is an amount of a food, so one only ever arrives with a food
   * already behind it — priced here, before it is pushed, so the grid never
   * paints a row with blank numbers on its way in.
   */
  function addEntry(mealId: string | null, partial: Partial<GridEntry> = {}): GridEntry {
    const entry: GridEntry = {
      id: crypto.randomUUID(),
      mealId,
      position: nextPosition(mealId),
      foodId: null,
      nameSnapshot: '',
      quantity: null,
      counted: true,
      kcal: null,
      protein: null,
      fat: null,
      carbs: null,
      ...partial
    }
    reprice(entry)
    entries.value.push(entry)
    touch(entry.id)
    return entry
  }

  function updateEntry(id: string, patch: Partial<GridEntry>) {
    const entry = entries.value.find(e => e.id === id)
    if (!entry) return
    Object.assign(entry, patch)
    reprice(entry)
    if (entry.foodId) touch(entry.id)
  }

  /**
   * Log an amount of a food into a meal.
   *
   * `food` is either one taken from the library or a name the library has never
   * heard of, which it gains here: a food entered while logging is a food you
   * own, not a one-off scribble, so the macros typed into it once are there
   * tomorrow.
   *
   * Nothing reaches the grid until there is a food behind it — a row that names
   * nothing is not something the log can hold — so this answers with the row it
   * made, or null when the library could not be reached and there is therefore
   * nothing to log.
   */
  async function logFood(
    mealId: string | null,
    food: DayFood | string,
    quantity: number | null
  ): Promise<GridEntry | null> {
    const resolved = typeof food === 'string' ? await findOrCreateFood(food) : food
    if (!resolved) return null

    rememberFood(resolved)
    return addEntry(mealId, {
      foodId: resolved.id,
      nameSnapshot: resolved.name,
      quantity
    })
  }

  /**
   * The library's food by that name, adding it if there is none.
   *
   * A food already there under the same name is reused rather than duplicated,
   * which is what keeps a week of logging from filling the library with copies
   * of "porridge".
   */
  async function findOrCreateFood(name: string): Promise<DayFood | null> {
    try {
      const matches = await $fetch<DayFood[]>('/api/foods', { query: { q: name, limit: 10 } })
      const existing = matches.find(f => f.name.toLowerCase() === name.toLowerCase())
      if (existing) return existing

      const created = await $fetch<DayFood>('/api/foods', {
        method: 'POST',
        body: { name, kcal: 0, protein: 0, fat: 0, carbs: 0 }
      })
      library.upsert(created)
      return created
    } catch (e) {
      // The library is unreachable, so there is no food to log and no row to
      // put one on. The caller says so; nothing is left half-logged.
      error.value = (e as Error).message
      return null
    }
  }

  /**
   * Take on a food that was just saved elsewhere — the edit modal writes it
   * itself — and re-price every row on the day that uses it.
   *
   * A linked row's numbers come from its food, so correcting the food is how a
   * row's macros are corrected, and the grid has to show that immediately.
   */
  function adoptFood(food: DayFood) {
    rememberFood(food)
    library.upsert(food)

    for (const entry of entries.value) {
      if (entry.foodId !== food.id) continue
      entry.nameSnapshot = food.name
      reprice(entry)
      dirty.value.add(entry.id)
    }
    scheduleFlush()
  }

  /**
   * Recompute a row's macros locally using the very same function the server
   * will use when it saves, so the number on screen is the number stored.
   */
  function reprice(entry: GridEntry) {
    if (!entry.foodId) return
    const food = foodCache.value.get(entry.foodId)
    if (!food) return
    const macros = roundMacros(resolveMacros(food, entry.quantity ?? 0), 2)
    entry.kcal = macros.kcal
    entry.protein = macros.protein
    entry.fat = macros.fat
    entry.carbs = macros.carbs
  }

  /**
   * Remove a row, leaving it undoable for a moment.
   *
   * The row leaves the grid at once — the totals have to react immediately or
   * the delete does not feel like it happened — but nothing is sent to the
   * server until the undo window closes. That way undo is a local restore
   * rather than a re-insert racing its own deletion.
   */
  function removeEntry(id: string) {
    const index = entries.value.findIndex(e => e.id === id)
    if (index === -1) return

    const entry = entries.value[index]
    if (!entry) return

    entries.value.splice(index, 1)
    dirty.value.delete(id)
    removals.set(id, {
      entry,
      index,
      // Held a little past the window the toast advertises, so an undo clicked
      // as the toast fades still lands.
      timer: setTimeout(() => commitRemoval(id), UNDO_WINDOW_MS + 500)
    })
  }

  /** The undo window has closed (or the day is being left): make it permanent. */
  function commitRemoval(id: string) {
    const removal = removals.get(id)
    if (!removal) return
    clearTimeout(removal.timer)
    removals.delete(id)
    pendingDeletes.value.add(id)
    scheduleFlush()
  }

  function commitRemovals() {
    for (const id of [...removals.keys()]) commitRemoval(id)
  }

  /** Put a removed row back where it was. No-op once its window has closed. */
  function undoRemove(id: string) {
    const removal = removals.get(id)
    if (!removal) return false

    clearTimeout(removal.timer)
    removals.delete(id)
    entries.value.splice(Math.min(removal.index, entries.value.length), 0, removal.entry)
    // The row may never have reached the server, or may have been carrying
    // unsaved edits when it was removed; re-saving it covers both.
    if (removal.entry.foodId) touch(removal.entry.id)
    return true
  }

  function touch(id: string) {
    dirty.value.add(id)
    scheduleFlush()
  }

  // --- ordering -----------------------------------------------------------

  /**
   * Which section a row is rendered in.
   *
   * A row whose meal this user no longer has falls to the catch-all, exactly as
   * `entriesByMeal` groups it — the two must agree, or a drop computed here
   * would count rows the grid never showed.
   */
  function bucketOf(entry: GridEntry) {
    return meals.value.some(m => m.id === entry.mealId) ? entry.mealId : null
  }

  /** The rows of one section, in the order the grid draws them. */
  function bucket(mealId: string | null) {
    return entriesByMeal.value.get(mealId) ?? []
  }

  /**
   * Where a drop would put the row, or null when it would leave it where it is.
   *
   * Asked on every frame of a drag, so it answers with the landing place rather
   * than taking it: the grid draws the line from what comes back, and the same
   * answer is what the release applies.
   */
  function resolveDrop(id: string, target: DropTarget) {
    const entry = entries.value.find(e => e.id === id)
    if (!entry) return null

    const rest = bucket(target.mealId).filter(e => e.id !== id)

    let index = rest.length
    if (target.entryId) {
      const against = rest.findIndex(e => e.id === target.entryId)
      if (against !== -1) index = target.edge === 'before' ? against : against + 1
    }

    // A row taken out of its own meal and put back at the place it was taken
    // from lands at the index it already sits at, so that is what "no move" is.
    if (bucket(target.mealId).findIndex(e => e.id === id) === index) return null

    return { mealId: target.mealId, index }
  }

  /**
   * Put a row in a meal at a given place within it.
   *
   * `index` counts the meal's other rows, not its own — the place the row goes
   * once it is out of the way, which is what both a drop and a nudge know.
   */
  function moveEntry(id: string, mealId: string | null, index: number) {
    const entry = entries.value.find(e => e.id === id)
    if (!entry) return false

    const source = bucket(bucketOf(entry)).filter(e => e.id !== id)
    const target = bucketOf(entry) === mealId ? source : bucket(mealId).filter(e => e.id !== id)

    target.splice(Math.max(0, Math.min(index, target.length)), 0, entry)
    entry.mealId = mealId

    // The row's place in its meal is its position, so a move rewrites the whole
    // run either side of it. Only the rows that actually shifted are sent.
    renumber(source)
    if (target !== source) renumber(target)
    touch(id)
    return true
  }

  function renumber(list: GridEntry[]) {
    list.forEach((entry, index) => {
      if (entry.position === index) return
      entry.position = index
      dirty.value.add(entry.id)
    })
  }

  /** The sections the grid shows, in the order it shows them. */
  function sectionOrder(): Array<string | null> {
    const order: Array<string | null> = meals.value.map(m => m.id)
    // The catch-all is only drawn when something is in it, so it is only
    // somewhere a row can be moved to while it is.
    if (bucket(null).length) order.push(null)
    return order
  }

  /**
   * Move a row one place up or down, crossing into the next meal at the ends.
   *
   * The keyboard's drag: the same two moves — reorder, and change meal — for
   * someone who has no gesture to make. Answers with the meal it landed in, so
   * the caller can open that section if it was folded shut.
   */
  function nudgeEntry(id: string, delta: -1 | 1) {
    const entry = entries.value.find(e => e.id === id)
    if (!entry) return null

    const mealId = bucketOf(entry)
    const siblings = bucket(mealId)
    const index = siblings.findIndex(e => e.id === id)
    if (index === -1) return null

    const next = index + delta
    if (next >= 0 && next < siblings.length) {
      return moveEntry(id, mealId, next) ? { mealId } : null
    }

    const order = sectionOrder()
    const neighbour = order[order.indexOf(mealId) + delta]
    if (neighbour === undefined) return null

    // Leaving downwards arrives at the top of the next meal, leaving upwards at
    // the bottom of the one before: the row keeps travelling the way it was sent.
    const landing = delta < 0 ? bucket(neighbour).length : 0
    return moveEntry(id, neighbour, landing) ? { mealId: neighbour } : null
  }

  // --- saving -------------------------------------------------------------

  function scheduleFlush(delay = 600) {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => void flush(), delay)
  }

  /**
   * Save the outstanding work, queued behind any save already running.
   *
   * The returned promise resolves once this round is done, so awaiting it
   * waits out the whole queue and not just the last link.
   */
  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    inFlight = inFlight.then(runFlush)
    return inFlight
  }

  /** One round: whatever is dirty by the time the queue reaches it. */
  async function runFlush() {
    if (!dirty.value.size && !pendingDeletes.value.size) return

    saving.value = true
    error.value = null
    try {
      await flushDay()
    } catch (e) {
      error.value = (e as Error).message
      // The rows are dirty again, so try them once more rather than leaving
      // the edit sitting there until something else happens to touch it.
      scheduleFlush(3000)
    } finally {
      saving.value = false
    }
  }

  /**
   * Save everything, including removals still inside their undo window.
   *
   * For when the grid is about to stop being watched — the tab is hidden, the
   * day is changing — where waiting out an undo that can no longer be clicked
   * would mean losing the deletion altogether.
   */
  async function flushNow() {
    commitRemovals()
    await flush()
  }

  async function flushDay() {
    // Name and macros are the food's, and the server reads them from it; a row
    // is an amount of a food and nothing more.
    const upserts = entries.value
      .filter(e => dirty.value.has(e.id) && e.foodId)
      .map(e => ({
        id: e.id,
        mealId: e.mealId,
        position: e.position,
        foodId: e.foodId,
        quantity: e.quantity,
        counted: e.counted
      }))
    const deletes = [...pendingDeletes.value]

    // Cleared up front so edits made during the request are not lost with the
    // response; they simply mark their rows dirty again and flush next round.
    dirty.value.clear()
    pendingDeletes.value.clear()

    if (!upserts.length && !deletes.length) return

    try {
      const data = await $fetch<DayResponse>(`/api/log/${date.value}`, {
        method: 'PUT',
        body: { upserts, deletes }
      })
      // Adopt the server's macros only for rows the user is not still editing.
      const byId = new Map(data.entries.map(e => [e.id, e]))
      entries.value = entries.value.map(local =>
        dirty.value.has(local.id) ? local : (byId.get(local.id) ?? local)
      )
      for (const server of data.entries) {
        // A row waiting out its undo window is off the grid on purpose; the
        // server still has it until the window closes.
        if (removals.has(server.id)) continue
        if (!entries.value.some(e => e.id === server.id)) entries.value.push(server)
      }
    } catch (e) {
      // Put the work back so nothing is silently dropped.
      for (const row of upserts) dirty.value.add(row.id)
      for (const id of deletes) pendingDeletes.value.add(id)
      throw e
    }
  }

  return {
    date,
    meals,
    entries,
    goal,
    loading,
    saving,
    error,
    totals,
    remaining,
    exceeded,
    hasGoal,
    entriesByMeal,
    foodCache,
    isIncomplete,
    load,
    updateEntry,
    logFood,
    adoptFood,
    removeEntry,
    undoRemove,
    resolveDrop,
    moveEntry,
    nudgeEntry,
    rememberFood,
    flush,
    flushNow
  }
})
