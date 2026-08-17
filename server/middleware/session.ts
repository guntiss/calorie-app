import { SESSION_RENEW_AFTER } from '../../shared/utils/session'

/**
 * Push the session cookie's expiry forward as the app is used.
 *
 * The cookie carries a year-long `Max-Age`, but a fixed one would still turn
 * into a forced sign-in a year after the account was created. Re-sending the
 * cookie restarts that year from now, which is what makes the session roll
 * rather than run out.
 *
 * It has to be re-sent rather than extended in place: h3 stamps `createdAt`
 * when the session is minted and derives nothing from later writes, so only a
 * fresh `Set-Cookie` moves the deadline. `SESSION_MAX_AGE` therefore lives in
 * `cookie.maxAge` and not in the session config — the session config form also
 * makes h3 reject the cookie server-side once `createdAt` is old enough, which
 * no amount of re-sending would fix.
 */
export default defineEventHandler(async (event) => {
  // Hashed build assets are requested dozens of times per launch and carry no
  // interest in the session; unsealing the cookie for them is pure overhead.
  if (event.path.startsWith('/_nuxt/') || event.path.startsWith('/__nuxt')) return

  const { user, renewedAt } = await getUserSession(event)
  if (!user) return

  if (renewedAt && Date.now() - renewedAt < SESSION_RENEW_AFTER) return

  await setUserSession(event, { renewedAt: Date.now() })
})
