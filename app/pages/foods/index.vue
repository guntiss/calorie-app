<script setup lang="ts">
import type { DayFood } from '~/stores/dayLog'

const library = useFoodLibraryStore()

const query = ref('')

/** The food the modal is on. Foods are only ever corrected here, never created. */
const editing = ref<DayFood | null>(null)
const modalOpen = ref(false)

// The whole library, not the first hundred of it: this screen is where a food
// is gone looking for to be corrected, and one that has fallen off the end of
// the list is one that cannot be fixed from anywhere.
const { data: foods, status, refresh } = await useFetch<DayFood[]>('/api/foods', {
  query: { q: query, limit: 500 }
})

/** Waiting on the library with nothing to show meanwhile. */
const loading = computed(() => status.value === 'pending' && !foods.value?.length)

function open(food: DayFood) {
  editing.value = food
  modalOpen.value = true
}
</script>

<template>
  <div class="mx-auto max-w-md px-4 pb-16">
    <PullToRefresh :on-refresh="refresh" />

    <header class="flex items-center gap-2 py-3">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/" aria-label="Back" />
      <h1 class="flex-1 text-lg font-semibold">
        My foods
      </h1>
    </header>

    <UInput
      v-model="query"
      icon="i-lucide-search"
      placeholder="Search your foods"
      class="mb-3 w-full"
    />

    <ul class="divide-y divide-default">
      <li
        v-for="food in foods"
        :key="food.id"
        class="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-elevated"
      >
        <button
          type="button"
          class="min-w-0 flex-1 rounded-md text-left outline-none
                 focus-visible:ring-1 focus-visible:ring-primary"
          @click="open(food)"
        >
          <p class="truncate text-sm font-medium">
            {{ food.name }}
            <span v-if="food.brand" class="font-normal text-dimmed">· {{ food.brand }}</span>
          </p>
          <p class="num text-xs text-muted">
            {{ Math.round(food.kcal) }} kcal ·
            P{{ Math.round(food.protein) }} F{{ Math.round(food.fat) }} C{{ Math.round(food.carbs) }}
            <span class="text-dimmed">/ 100g</span>
          </p>
        </button>
        <!-- How many logged rows the food is standing behind — and, since the
             last of them to go takes it with it, how much of it is left. -->
        <span
          v-if="food.logCount"
          class="num shrink-0 text-xs text-dimmed"
          :title="`Logged ${food.logCount} ${food.logCount === 1 ? 'time' : 'times'}`"
        >{{ food.logCount }}×</span>
      </li>
    </ul>

    <div v-if="loading" class="grid place-items-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
    </div>

    <!-- The library is a record of what has been logged, so it is filled in by
         logging: there is nothing to add here, and nothing to remove. Said only
         once the list has actually come back: an empty screen mid-request is
         not yet an empty library. -->
    <p v-else-if="!foods?.length" class="py-10 text-center text-sm text-dimmed">
      No foods yet. Log something on a day and it lands here, ready to edit.
    </p>

    <!-- Saved into the device's copy as well as refetched here: the picker
         searches that copy, and a correction made on this screen should be in
         the list the next meal is logged from. -->
    <FoodEditModal
      v-model:open="modalOpen"
      :food="editing"
      @saved="library.upsert($event); refresh()"
    />
  </div>
</template>
