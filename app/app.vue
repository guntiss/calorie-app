<script setup lang="ts">
useHead({
  meta: [
    // `viewport-fit=cover` so the sticky day footer can sit above the home indicator.
    // `maximum-scale=1, user-scalable=no` blocks the pinch/double-tap zoom outright:
    // this is a fixed single-column logging surface, and an accidental zoom during
    // entry leaves the grid off-centre with no obvious way back.
    { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
    { name: 'theme-color', content: '#0f172a' },

    // Installed-app metadata. iOS only keeps a home-screen launch inside the
    // standalone window while the URL stays within the manifest's scope —
    // without a manifest it scopes to the single page that was added, so every
    // route change but the first came back with Safari's title bar and toolbar.
    // `apple-mobile-web-app-capable` is the pre-16.4 form of the same opt-in.
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-title', content: 'Calorie' },
    // `black` keeps the status bar opaque: nothing here pads for a top inset,
    // so `black-translucent` would run the day grid under the clock.
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }
  ],

  link: [
    { rel: 'manifest', href: '/manifest.webmanifest' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192.png' }
  ],

  htmlAttrs: { lang: 'en' }
})

useSeoMeta({
  title: 'Calorie',
  description: 'Effortless food logging built around your own foods.'
})

const { position: toastPosition } = useToastPosition()
</script>

<template>
  <!-- Toasts come from the bottom, within thumb reach of the undo they carry,
       except where the keypad is up over that corner — see useToastPosition. -->
  <UApp :toaster="{ position: toastPosition }">
    <!-- Ambient wash behind every page. Fixed rather than part of the page flow,
         so the blooms hold still while a long day scrolls past them, and clipped
         to the viewport rather than to any one section — the food picker's
         suggestions have to stay free to hang outside the row they belong to.
         Blurred at this radius the three circles read as one soft gradient; they
         are only circles so the light falls in predictable places. -->
    <div
      aria-hidden="true"
      class="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-muted"
    >
      <div class="absolute -top-40 -left-32 size-[28rem] rounded-full bg-primary-200/30 blur-3xl dark:bg-primary-500/15" />
      <div class="absolute top-1/4 -right-40 size-[32rem] rounded-full bg-sky-200/25 blur-3xl dark:bg-sky-500/10" />
      <div class="absolute -bottom-48 left-1/5 size-[30rem] rounded-full bg-teal-100/35 blur-3xl dark:bg-teal-500/10" />
    </div>

    <NuxtPage />
  </UApp>
</template>
