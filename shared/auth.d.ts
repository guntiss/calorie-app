declare module '#auth-utils' {
  interface User {
    id: string
    name: string
    avatarUrl: string | null
  }

  interface UserSession {
    user: User
    /**
     * When the cookie was last re-issued, in epoch milliseconds. h3 fixes its
     * own `createdAt` at sign-in and never moves it, so the rolling window is
     * tracked here instead — see `server/middleware/session.ts`.
     */
    renewedAt?: number
  }
}

export {}
