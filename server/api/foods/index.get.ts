import { and, asc, count, eq, getTableColumns, ilike, inArray, or, sql } from 'drizzle-orm'

/**
 * Type-ahead search across the user's own foods and their household's.
 * Backs the inline picker in the day grid, so it stays small and fast.
 *
 * Also answers `?barcode=` with the foods carrying a scanned code, which is the
 * one question the picker cannot answer from the copy on the device: a food a
 * household member added since the last refresh is exactly the one being
 * scanned for.
 */
export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)
  const query = getQuery(event)

  const q = typeof query.q === 'string' ? query.q.trim() : ''
  // Up to the whole library in one response: the picker keeps a copy on the
  // device and searches that, so it asks for everything rather than a page. The
  // ceiling is a guard against a runaway query, not a page size — a household's
  // foods are counted in hundreds at the very most.
  const limit = Math.min(Number(query.limit) || 25, 500)
  const includeArchived = query.includeArchived === 'true'

  const filters = [visibleFoodsWhere(user)]
  if (!includeArchived) filters.push(eq(tables.foods.isArchived, false))
  if (query.kind === 'item' || query.kind === 'recipe') {
    filters.push(eq(tables.foods.kind, query.kind))
  }
  if (q) {
    filters.push(or(
      ilike(tables.foods.name, `%${q}%`),
      ilike(tables.foods.brand, `%${q}%`)
    )!)
  }

  // A scan asks about the code it read, and about every other way the same
  // packet writes that code down — see `barcodeVariants`. Answered against the
  // library the user can see like any other query, so a household's foods are
  // found and a stranger's are not.
  const scanned = typeof query.barcode === 'string' ? barcodeVariants(query.barcode) : null
  if (scanned) {
    // A code that folds away to nothing is a question with no answer, not an
    // absent filter: falling through would hand back the whole library to a
    // caller that asked about one packet.
    if (!scanned.length) return []
    filters.push(inArray(tables.foods.barcode, scanned))
  }

  // How many logged rows name the food, counted across the household rather
  // than this user: the library is shared, so its tally is too. It is also what
  // keeps the food alive — the last row to go takes the food with it.
  //
  // Built through the query builder rather than written out by hand: a raw
  // subquery leaves its columns unqualified, and `food_id = id` inside
  // `log_entries` compares a row with its own id, which is never true.
  const logCount = sql<number>`(${
    useDb()
      .select({ n: count() })
      .from(tables.logEntries)
      .where(eq(tables.logEntries.foodId, tables.foods.id))
  })`.mapWith(Number)

  return useDb()
    .select({ ...getTableColumns(tables.foods), logCount })
    .from(tables.foods)
    .where(and(...filters))
    .orderBy(asc(tables.foods.name))
    .limit(limit)
})
