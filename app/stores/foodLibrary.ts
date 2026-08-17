import { defineStore } from 'pinia'
import type { DayFood } from './dayLog'
import type { FoldedText, MatchRange } from '~/utils/search'

/**
 * How much of the library is held.
 *
 * A household's foods are counted in hundreds at the very most — the library
 * only ever gains what has actually been eaten — so the whole thing is kept
 * rather than a page of it. That is the point: searching a list you already
 * have is instant, and a picker that answers a keystroke over the network is
 * one that answers it a third of a second late, every time, on the connection
 * a phone has in a kitchen.
 */
const LIMIT = 500

/** Where the copy lives between visits, per user — a browser can hold two. */
const STORAGE_PREFIX = 'calorie-app:foods:'

/** A food and where the query landed in it, in source offsets. */
export interface FoodMatch {
  food: DayFood
  name: MatchRange[]
  brand: MatchRange[]
}

interface Indexed {
  food: DayFood
  name: FoldedText
  brand: FoldedText | null
}

interface Cached {
  savedAt: number
  foods: DayFood[]
  /** Carried across visits, so the first keystroke of a session already knows
   * whether the copy can be trusted to answer on its own. */
  truncated?: boolean
}

/**
 * The food library, kept on the device.
 *
 * Restored from `localStorage` as the store is created, so the picker opens
 * onto a full list on the first frame instead of a spinner — and then
 * refreshed from the server behind that list, because a stale library is only
 * a problem if it is also the last word.
 */
export const useFoodLibraryStore = defineStore('foodLibrary', () => {
  const { user } = useUserSession()

  const foods = ref<DayFood[]>([])

  /** Whether a refresh is out. Only worth showing when there is nothing yet. */
  const fetching = ref(false)

  /** Whether the server has answered since the app was opened. */
  const fresh = ref(false)

  /**
   * Whether the copy is the whole library or only as much of it as fits.
   *
   * A household never gets near the ceiling, but "never" is not "cannot", and a
   * picker that quietly cannot find a food is worse than a slow one — so past
   * the ceiling the server is asked about what is typed, and what it sends back
   * joins the copy.
   */
  const truncated = ref(false)

  const key = computed(() => (user.value?.id ? STORAGE_PREFIX + user.value.id : null))

  // --- the copy on the device ---------------------------------------------

  /**
   * Whether the copy on the device has been read yet.
   *
   * Read on demand rather than as the store is built: this store is built
   * during the server render too, and Pinia hands that state to the browser and
   * lays it over whatever the client's own setup produced — so anything
   * restored there is thrown away moments later. Everything below goes through
   * `sync`, which is only ever called from the browser, well after that.
   */
  let restored = false

  function restore() {
    if (restored || !import.meta.client || !key.value) return
    restored = true
    try {
      const raw = localStorage.getItem(key.value)
      if (!raw) return
      const cached = JSON.parse(raw) as Cached
      if (!Array.isArray(cached?.foods)) return
      foods.value = cached.foods
      truncated.value = cached.truncated ?? false
    } catch {
      // Written by an older version of this, or half-written by a tab that was
      // closed mid-save. Either way it is a copy of something the server still
      // has; drop it and let the refresh below fill it back in.
      localStorage.removeItem(key.value)
    }
  }

  function persist() {
    if (!import.meta.client || !key.value) return
    try {
      localStorage.setItem(key.value, JSON.stringify({
        savedAt: Date.now(),
        foods: foods.value,
        truncated: truncated.value
      } satisfies Cached))
    } catch {
      // Out of quota, or a browser in private mode that refuses to store at
      // all. The cache is a head start, not the data — the app works without
      // it, one round trip slower.
    }
  }

  // --- keeping it current --------------------------------------------------

  /**
   * How many refreshes are in the air, so two callers share one request.
   *
   * The picker opening, a save landing and the day loading all ask, often in
   * the same beat.
   */
  let inFlight: Promise<void> | null = null

  /** Pull the library down again, over whatever is held. */
  function sync(): Promise<void> {
    restore()
    if (inFlight) return inFlight

    fetching.value = true
    inFlight = $fetch<DayFood[]>('/api/foods', { query: { limit: LIMIT } })
      .then((list) => {
        foods.value = list
        truncated.value = list.length >= LIMIT
        fresh.value = true
        persist()
      })
      .catch(() => {
        // Keep what is on screen. A library that cannot be reached is exactly
        // when the copy on the device earns its keep.
      })
      .finally(() => {
        fetching.value = false
        inFlight = null
      })

    return inFlight
  }

  /**
   * Take on a food that was just written, without waiting for a round trip to
   * confirm what we already know.
   */
  function upsert(food: DayFood) {
    const at = foods.value.findIndex(f => f.id === food.id)
    // The tally is the server's to count, and a food arriving from a save does
    // not carry one — keeping the old one leaves the list in the order it was
    // just being read in.
    if (at === -1) foods.value.push(food)
    else foods.value[at] = { logCount: foods.value[at]!.logCount, ...food }
    persist()
  }

  /**
   * Ask the server about a query the copy on the device cannot be trusted to
   * answer, and keep whatever comes back.
   *
   * Only reached for a library past the ceiling. What arrives is merged into
   * the copy rather than shown beside it, so those foods are searched,
   * highlighted and ordered by exactly the same rules as the rest — and stay
   * found once they have been found once.
   */
  async function reach(query: string): Promise<void> {
    const q = query.trim()
    if (!truncated.value || !q) return

    try {
      const found = await $fetch<DayFood[]>('/api/foods', { query: { q, limit: 25 } })
      const known = new Map(foods.value.map(f => [f.id, f]))
      for (const food of found) {
        if (!known.has(food.id)) foods.value.push(food)
      }
      persist()
    } catch {
      // The copy on the device is still there to search; this only ever adds.
    }
  }

  // --- barcodes -------------------------------------------------------------

  /**
   * The food carrying a scanned code, from the copy on the device.
   *
   * Every form of the code is asked about, because the same packet is written
   * down differently by different scanners — see `barcodeVariants`. Answered
   * without a round trip, which is the point: the phone is being held over a
   * tin and the answer should be there when it comes back up.
   */
  function byBarcode(code: string): DayFood | null {
    const forms = barcodeVariants(code)
    if (!forms.length) return null
    return foods.value.find(f => f.barcode && forms.includes(f.barcode)) ?? null
  }

  /**
   * The same question, with the server asked when the copy has no answer.
   *
   * The copy is nearly always the whole library, so this second half is for the
   * food someone else in the household scanned in this afternoon — and for a
   * library past the ceiling, where the copy was never the whole of it.
   * Whatever comes back joins the copy, so the next scan of that packet is
   * instant.
   */
  async function lookup(code: string): Promise<DayFood | null> {
    const local = byBarcode(code)
    if (local) return local
    if (!barcodeVariants(code).length) return null

    try {
      const [found] = await $fetch<DayFood[]>('/api/foods', { query: { barcode: code, limit: 1 } })
      if (found) upsert(found)
      return found ?? null
    } catch {
      // No network, or none reaching the server. The copy on the device has
      // already said it does not know this packet; that stands.
      return null
    }
  }

  function forget(id: string) {
    foods.value = foods.value.filter(f => f.id !== id)
    persist()
  }

  // --- searching -----------------------------------------------------------

  /**
   * The library folded ready to be searched.
   *
   * Done once per list rather than once per keystroke: the folding is the
   * expensive half, and the list changes when a food is saved, which is far
   * rarer than typing.
   */
  const index = computed<Indexed[]>(() => foods.value.map(food => ({
    food,
    name: fold(food.name),
    brand: food.brand ? fold(food.brand) : null
  })))

  /**
   * The library as the picker should show it for a query.
   *
   * Every word of the query has to land somewhere — name or brand — so typing
   * more always narrows. What comes back carries where each word landed, so
   * the list can show why a row is on it.
   *
   * Ordered by how the query sits in the name, then by how often the food has
   * been logged: what someone eats is a short list repeated, so with nothing
   * typed the usual foods are already under the thumb.
   */
  function search(query: string): FoodMatch[] {
    const terms = foldQuery(query)
    const scored: Array<{ match: FoodMatch, rank: number }> = []

    for (const entry of index.value) {
      const name: MatchRange[] = []
      const brand: MatchRange[] = []
      let rank = 0
      let missed = false

      for (const term of terms) {
        const inName = occurrences(entry.name, term)
        const inBrand = entry.brand ? occurrences(entry.brand, term) : []

        if (!inName.length && !inBrand.length) {
          missed = true
          break
        }

        name.push(...rangesAt(entry.name, term, inName))
        if (entry.brand) brand.push(...rangesAt(entry.brand, term, inBrand))
        // A word found in the name beats the same word found in the brand: the
        // name is what was searched for, the brand is which one of it.
        rank += inName.length ? placement(entry.name, inName) : 3
      }

      if (missed) continue
      scored.push({ match: { food: entry.food, name, brand }, rank })
    }

    scored.sort((a, b) =>
      a.rank - b.rank
      || (b.match.food.logCount ?? 0) - (a.match.food.logCount ?? 0)
      || a.match.food.name.localeCompare(b.match.food.name))

    return scored.map(s => s.match)
  }

  return { foods, fetching, fresh, truncated, sync, reach, upsert, forget, search, byBarcode, lookup }
})
