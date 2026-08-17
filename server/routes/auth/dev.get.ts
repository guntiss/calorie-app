/**
 * Development-only sign-in.
 *
 * Google OAuth needs a public callback URL, which makes local work and end-to-end
 * tests awkward. This mints a session for a fixed local account instead. It 404s
 * outside dev mode, so it cannot be reached on the deployed server.
 */
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const record = await upsertGoogleUser({
    sub: 'dev-local-user',
    email: 'dev@localhost',
    name: 'Dev User'
  })

  await setUserSession(event, {
    user: { id: record.id, name: record.name, avatarUrl: record.avatarUrl },
    renewedAt: Date.now()
  })

  return sendRedirect(event, '/')
})
