export default defineEventHandler(async (event) => {
  const user = await requireDbUser(event)
  const input = await readValidatedJson(event, foodInputSchema)

  const [food] = await useDb()
    .insert(tables.foods)
    .values({
      ...input,
      ownerUserId: user.id,
      // Mirroring the household here is what puts the food in the shared library.
      householdId: user.householdId
    })
    .returning()

  setResponseStatus(event, 201)
  return food
})
