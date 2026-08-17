export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)
  const query = getQuery(event)

  const parsed = isoDateSchema.safeParse(query.date)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'A ?date=YYYY-MM-DD is required' })
  }

  const goal = await goalForDate(user.id, parsed.data)
  return { date: parsed.data, goal }
})
