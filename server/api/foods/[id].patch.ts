import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)
  const id = getRouterParam(event, 'id')!
  const patch = await readValidatedJson(event, foodPatchSchema)

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

  const [updated] = await db
    .update(tables.foods)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tables.foods.id, id))
    .returning()

  return updated
})
