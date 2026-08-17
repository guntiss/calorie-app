import { eq } from 'drizzle-orm'

/**
 * Delete a food outright — and refuse to, the moment anything points at it.
 *
 * Every logged row names a food in the library, so removing a food that has
 * ever been logged would leave the day it belongs to describing something that
 * no longer exists. A food that nothing refers to is nobody's history, and goes
 * for good.
 */
export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)
  const id = getRouterParam(event, 'id')!

  const db = useDb()
  const [existing] = await db
    .select()
    .from(tables.foods)
    .where(eq(tables.foods.id, id))
    .limit(1)

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Food not found' })
  if (!canEditFood(user, existing)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your food' })
  }

  // Not scoped to this user: a household shares its library, so a food someone
  // else has logged is still logged.
  const [logged] = await db
    .select({ id: tables.logEntries.id })
    .from(tables.logEntries)
    .where(eq(tables.logEntries.foodId, id))
    .limit(1)

  if (logged) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This food is used in your log and cannot be deleted'
    })
  }

  const [component] = await db
    .select({ id: tables.recipeComponents.id })
    .from(tables.recipeComponents)
    .where(eq(tables.recipeComponents.childFoodId, id))
    .limit(1)

  if (component) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This food is an ingredient in a recipe and cannot be deleted'
    })
  }

  await db.delete(tables.foods).where(eq(tables.foods.id, id))

  return { ok: true }
})
