import { eq } from 'drizzle-orm'

/** Meal sections every new account starts with. Renameable afterwards. */
const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']

export interface GoogleProfile {
  sub: string
  email: string
  name?: string
  picture?: string
}

/**
 * Find or create the user behind a Google login.
 *
 * Google's `sub` is the stable identity — email can change on the Google side,
 * so it is refreshed on every login rather than used as the key.
 */
export async function upsertGoogleUser(profile: GoogleProfile) {
  const db = useDb()

  const [existing] = await db
    .select()
    .from(tables.users)
    .where(eq(tables.users.googleSub, profile.sub))
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(tables.users)
      .set({
        email: profile.email,
        name: profile.name ?? existing.name,
        avatarUrl: profile.picture ?? existing.avatarUrl
      })
      .where(eq(tables.users.id, existing.id))
      .returning()
    return updated!
  }

  const [created] = await db
    .insert(tables.users)
    .values({
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name ?? profile.email,
      avatarUrl: profile.picture ?? null
    })
    .returning()

  await db.insert(tables.meals).values(
    DEFAULT_MEALS.map((name, position) => ({ userId: created!.id, name, position }))
  )

  return created!
}
