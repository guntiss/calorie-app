/**
 * Google OAuth entry point and callback in one handler.
 *
 * The authorised redirect URI in the Google console must be this exact path:
 *   https://<your-domain>/auth/google
 */
export default defineOAuthGoogleEventHandler({
  config: {
    scope: ['email', 'profile']
  },

  async onSuccess(event, { user }) {
    const record = await upsertGoogleUser({
      sub: user.sub,
      email: user.email,
      name: user.name,
      picture: user.picture
    })

    // Only the id goes in the cookie. Everything else is read fresh from the
    // database per request, so a household change takes effect immediately
    // instead of waiting for the session to expire.
    await setUserSession(event, {
      user: { id: record.id, name: record.name, avatarUrl: record.avatarUrl },
      renewedAt: Date.now()
    })

    return sendRedirect(event, '/')
  },

  onError(event, error) {
    console.error('[auth] google oauth failed', error)
    return sendRedirect(event, '/login?error=oauth')
  }
})
