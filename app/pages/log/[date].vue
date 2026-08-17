<script setup lang="ts">
const route = useRoute()
const store = useDayLogStore()
const { user, clear } = useUserSession()

const date = computed(() => String(route.params.date))

// Client-only: the request needs the session cookie, and SSR would otherwise
// render a day the hydrated client immediately replaces.
watch(date, value => void store.load(value), { immediate: import.meta.client })

// A pending edit must not be lost when navigating away or backgrounding the
// tab — on mobile, switching apps is the usual way a session ends.
function flushOnHide() {
  if (document.visibilityState === 'hidden') void store.flushNow()
}

onMounted(() => document.addEventListener('visibilitychange', flushOnHide))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', flushOnHide)
  void store.flushNow()
})

/**
 * Whether the log modal is up.
 *
 * Logging is one button on the day rather than one at the foot of each meal:
 * the meal is picked inside the modal, so the button does not have to be
 * anywhere in particular — and it sits in the footer's bottom-right corner,
 * under the thumb, where it stays put as the day is scrolled.
 */
const logOpen = ref(false)

function go(days: number) {
  void store.flushNow()
  void navigateTo(`/log/${shiftIsoDate(date.value, days)}`)
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <!-- Standing in for the reload button the installed app does not have.
         `load` flushes pending edits before it refetches, so a pull mid-typing
         saves the day rather than discarding it. -->
    <PullToRefresh :on-refresh="() => store.load(date, { silent: true })" />

    <!-- The bars span the window; their contents line up with the grid, which is
         held to a readable column instead of stretching across a desktop. -->
    <header class="sticky top-0 z-20 border-b border-default/60 bg-default/70 backdrop-blur-xl">
      <div class="mx-auto flex w-full max-w-2xl items-center gap-1 px-2 py-2">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          aria-label="Previous day"
          @click="go(-1)"
        />

        <div class="min-w-0 flex-1 text-center">
          <h1 class="truncate text-sm font-semibold">
            {{ formatIsoDate(date) }}
          </h1>
          <p class="truncate text-[11px] text-dimmed">
            <span v-if="store.saving">Saving…</span>
            <span v-else-if="store.error" class="text-error">{{ store.error }}</span>
            <span v-else>{{ date }}</span>
          </p>
        </div>

        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          aria-label="Next day"
          @click="go(1)"
        />

        <UDropdownMenu
          :content="{ align: 'end' }"
          :items="[[
            { label: 'Today', icon: 'i-lucide-calendar', to: `/log/${todayIso()}` },
            { label: 'My foods', icon: 'i-lucide-book-open', to: '/foods' },
            { label: 'Goals', icon: 'i-lucide-target', to: '/settings' }
          ], [
            { label: user?.name ?? 'Sign out', icon: 'i-lucide-log-out', onSelect: logout }
          ]]"
        >
          <UButton icon="i-lucide-menu" color="neutral" variant="ghost" aria-label="Menu" />
        </UDropdownMenu>
      </div>
    </header>

    <!-- Transparent: the middle is where the ambient wash in app.vue shows
         through, which is what sets it apart from the two frosted bars. -->
    <main class="flex-1">
      <div class="mx-auto w-full max-w-2xl">
        <div v-if="store.loading" class="grid place-items-center py-16">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
        </div>
        <DayGrid v-else />
      </div>
    </main>

    <DayFooter v-if="!store.loading" @log="logOpen = true" />

    <!-- Mounted only while open, so the day is not carrying a dialog around
         behind it, and freshly built each time: the modal reads the library on
         the way in and starts from a clean amount. -->
    <FoodLogModal v-if="logOpen" v-model:open="logOpen" />
  </div>
</template>
