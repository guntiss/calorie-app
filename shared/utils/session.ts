/**
 * How long a cookie outlives its last use: a year of not opening the app.
 *
 * The session middleware pushes this window forward whenever the app is used,
 * so in practice a regular user is never signed out — the deadline only ever
 * arrives for someone who stopped logging altogether.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365

/**
 * How stale the cookie may get before a request re-issues it.
 *
 * Re-issuing costs a seal and a `Set-Cookie` on the response, so it is not
 * worth doing per request; a day is far short enough of the year above that
 * the window can never lapse while the app is in daily use.
 */
export const SESSION_RENEW_AFTER = 60 * 60 * 24 * 1000
