export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)

  const parsed = isoDateSchema.safeParse(getRouterParam(event, 'date'))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Expected a YYYY-MM-DD date' })
  }

  return loadDay(user, parsed.data)
})
