import { and, eq, inArray, notExists, sql } from 'drizzle-orm'
import type { z } from 'zod'

type EntryInput = z.output<typeof logEntryInputSchema>

/**
 * Batch save for one day.
 *
 * The grid accumulates dirty rows and flushes them together, so this reconciles
 * a whole set of adds, edits and deletes in one transaction. That is what keeps
 * editing five rows feeling like editing a spreadsheet rather than filing five
 * separate forms.
 */
export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)

  const parsedDate = isoDateSchema.safeParse(getRouterParam(event, 'date'))
  if (!parsedDate.success) {
    throw createError({ statusCode: 400, statusMessage: 'Expected a YYYY-MM-DD date' })
  }
  const date = parsedDate.data
  const { upserts, deletes } = await readValidatedJson(event, dayPatchSchema)

  const db = useDb()
  const foods = await loadReferencedFoods(user, upserts)

  await db.transaction(async (tx) => {
    /** Foods the removed rows named, which may now be spoken for by nothing. */
    const orphaned = new Set<string>()

    if (deletes.length) {
      // Scoped to this user and date so an id from elsewhere cannot be removed.
      const removed = await tx.delete(tables.logEntries).where(and(
        eq(tables.logEntries.userId, user.id),
        eq(tables.logEntries.logDate, date),
        inArray(tables.logEntries.id, deletes)
      )).returning({ foodId: tables.logEntries.foodId })

      for (const row of removed) orphaned.add(row.foodId)
    }

    for (const row of upserts) {
      // Present: `loadReferencedFoods` refused the whole batch otherwise.
      const food = foods.get(row.foodId)!

      const values = {
        userId: user.id,
        logDate: date,
        mealId: row.mealId ?? null,
        position: row.position,
        foodId: food.id,
        // Both taken from the food, so a client cannot log a name or a number
        // that disagrees with the library.
        nameSnapshot: food.name,
        quantity: row.quantity ?? null,
        counted: row.counted,
        ...roundMacros(resolveMacros(food, row.quantity ?? 0), 2),
        updatedAt: new Date()
      }

      // The client generates row ids, so a new row and an edit to an existing
      // one are the same write. `setWhere` means a colliding id belonging to
      // someone else is left untouched rather than overwritten.
      await tx.insert(tables.logEntries)
        .values({ ...values, id: row.id })
        .onConflictDoUpdate({
          target: tables.logEntries.id,
          set: values,
          setWhere: eq(tables.logEntries.userId, user.id)
        })
    }

    // Last, so that a row deleted and written back in the same batch — a food
    // moved between meals — is seen as the reference it still is.
    await dropOrphanedFoods(tx, user, orphaned)
  })

  return loadDay(user, date)
})

/** Load every food the batch refers to, in one query, respecting visibility. */
async function loadReferencedFoods(user: Awaited<ReturnType<typeof requireDbUser>>, rows: EntryInput[]) {
  const ids = [...new Set(rows.map(r => r.foodId))]
  if (!ids.length) return new Map<string, typeof tables.foods.$inferSelect>()

  const found = await useDb()
    .select()
    .from(tables.foods)
    .where(and(visibleFoodsWhere(user), inArray(tables.foods.id, ids)))

  if (found.length !== ids.length) {
    throw createError({ statusCode: 403, statusMessage: 'Unknown or inaccessible food referenced' })
  }

  return new Map(found.map(f => [f.id, f]))
}

/**
 * Remove foods that nothing logs any more.
 *
 * The library is written by logging, so it is unwritten the same way: a food
 * exists because some day names it, and the moment the last of those days lets
 * it go there is nothing left for the food to be. This is the only way a food
 * is removed, which is why it asks the whole database rather than this user's
 * day — a household shares its library, and a food someone else has logged is
 * still logged.
 */
async function dropOrphanedFoods(
  tx: Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0],
  user: Awaited<ReturnType<typeof requireDbUser>>,
  ids: Set<string>
) {
  if (!ids.size) return

  await tx.delete(tables.foods).where(and(
    inArray(tables.foods.id, [...ids]),
    // Never someone else's food, however few rows are left pointing at it.
    visibleFoodsWhere(user),
    notExists(
      tx.select({ one: sql`1` })
        .from(tables.logEntries)
        .where(eq(tables.logEntries.foodId, tables.foods.id))
    ),
    // An ingredient is a reference too, even with nothing logged.
    notExists(
      tx.select({ one: sql`1` })
        .from(tables.recipeComponents)
        .where(eq(tables.recipeComponents.childFoodId, tables.foods.id))
    )
  ))
}
