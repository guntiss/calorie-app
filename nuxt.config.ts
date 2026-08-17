// https://nuxt.com/docs/api/configuration/nuxt-config
import { SESSION_MAX_AGE } from './shared/utils/session'

export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
    'nuxt-auth-utils'
  ],

  // On by default; the screenshot capture switches it off so the floating badge
  // does not sit on top of the footer it is trying to photograph.
  devtools: { enabled: process.env.NUXT_DEVTOOLS_DISABLED !== '1' },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2026-06-30',

  runtimeConfig: {
    databaseUrl: '',

    public: {
      // The image tag the running container was built from (git short SHA),
      // set by the Helm chart from the same value it deploys — see
      // charts/cal-g4-lv/templates/deployment.yaml. Empty outside that
      // deployment (e.g. local dev, Vercel).
      appVersion: ''
    },

    session: {
      cookie: {
        sameSite: 'lax',
        // A persistent cookie, not a session one. Without an explicit lifetime
        // h3 sends no Max-Age at all, which browsers drop when the browsing
        // session ends — and an installed iOS web app ends its session every
        // time the system reclaims the app in the background, so the phone
        // signed out within a couple of hours while a desktop tab, which never
        // closes, stayed logged in. Renewed on use by the session middleware,
        // so the year is a year of inactivity rather than a hard cap.
        maxAge: SESSION_MAX_AGE
      }
    },

    oauth: {
      google: {
        clientId: '',
        clientSecret: ''
      }
    },

    gemini: {
      // NUXT_GEMINI_API_KEY. Absent is a supported state: the app works
      // exactly as before, minus the suggested macros.
      apiKey: '',
      // A food composition lookup is not a reasoning task, and the lite model
      // is the one that suits it: measured against this prompt it answers in
      // under a second where full Flash takes ten to sixteen, spends no
      // thinking tokens, and costs a fraction per lookup. Overridable with
      // NUXT_GEMINI_MODEL — but anything slower than a few seconds will not
      // fit inside the timeout the dialog allows.
      model: 'gemini-3.5-flash-lite'
    }
  },

  nitro: {
    // Self-hosting (Docker + Caddy) is the default target, but Vercel sets
    // VERCEL at build time and Nitro can pick its own preset there — pinning
    // node-server would write .output/ instead of the .vercel/output/ the
    // platform looks for.
    preset: process.env.VERCEL ? undefined : 'node-server'
  }
})
