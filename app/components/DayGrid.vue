<script setup lang="ts">
const store = useDayLogStore()

/** Meal sections plus a trailing catch-all for rows with no meal. */
const sections = computed(() => {
  const list = store.meals.map(meal => toSection(meal.id as string | null, meal.name, store.entriesByMeal.get(meal.id) ?? []))

  const loose = store.entriesByMeal.get(null) ?? []
  if (loose.length) list.push(toSection(null, 'Unsorted', loose))

  return list
})

const { isCollapsed, toggle: toggleSection } = useMealCollapse()

const drag = useEntryDrag()

/**
 * Whether a drop would land at the end of this meal rather than against one of
 * its rows — a meal with nothing showing under its header, so there is no row
 * for the line to be drawn on and the card says it instead.
 */
function isDropTarget(id: string | null) {
  return drag.target.value?.mealId === id && drag.target.value?.entryId === null
}

/**
 * Refuse the day the scroll it would otherwise take while a row is being
 * dragged — the drag scrolls it deliberately instead, near the edges.
 *
 * Listened for here, from the moment the grid mounts, rather than raised when a
 * drag begins: a browser settles at the start of a touch whether the page will
 * be allowed to have it, and a listener put up halfway through the gesture is
 * one Safari has already committed to scrolling past. That was the whole of the
 * bug — the day scrolled with the finger, the row hung where it was picked up,
 * and the line jumped between whatever rows were sliding under the finger.
 *
 * The cost is a handler on every scroll of the day, which returns immediately.
 */
function onTouchMove(event: TouchEvent) {
  if (drag.dragging.value && event.cancelable) event.preventDefault()
}

/** A section with its own totals, so the header reads them without recounting. */
function toSection(id: string | null, name: string, entries: typeof store.entries) {
  return { id, name, entries, totals: sectionTotals(entries) }
}

function sectionTotals(entries: typeof store.entries) {
  return dayTotals(entries.map(e => ({
    counted: e.counted,
    macros: e.kcal === null && e.protein === null && e.fat === null && e.carbs === null
      ? null
      : { kcal: e.kcal ?? 0, protein: e.protein ?? 0, fat: e.fat ?? 0, carbs: e.carbs ?? 0 }
  }))).total
}

const round = (n: number) => Math.round(n).toLocaleString()
</script>

<template>
  <!-- One card per meal, so a row plainly belongs to the meal it sits inside. -->
  <div class="space-y-3 px-2 py-3" @touchmove="onTouchMove">
    <!-- The card is not what clips its rows: a row slides out past its own left
         edge under a finger, and does its own clipping for that, so the bottom
         corners are rounded on the layers the last row paints with. -->
    <section
      v-for="section in sections"
      :key="section.id ?? 'none'"
      :data-meal="section.id ?? 'unsorted'"
      class="rounded-xl border border-default/70 bg-default/85 shadow-sm shadow-black/5
             [&>:last-child]:border-b-0 [&>header:last-child]:rounded-b-xl"
      :class="isDropTarget(section.id) ? 'ring-2 ring-primary' : ''"
    >
      <!-- The whole bar folds the section: it is one thing to say — show this
           meal or don't — and a bar-sized target says it without asking anyone
           to find a chevron. The chevron leads the bar as the mark of which way
           the section is facing, not as the place to press. -->
      <header class="rounded-t-xl border-b border-default bg-elevated/40">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-t-xl px-3 py-3 text-left
                 transition-colors hover:bg-elevated
                 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          :class="(isCollapsed(section.id) || !section.entries.length) && 'rounded-b-xl'"
          :aria-expanded="!isCollapsed(section.id)"
          :aria-label="`${isCollapsed(section.id) ? 'Show' : 'Hide'} ${section.name.toLowerCase()}`"
          @click="toggleSection(section.id)"
        >
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3.5 shrink-0 text-dimmed transition-transform duration-150"
            :class="isCollapsed(section.id) && '-rotate-90'"
          />
          <!-- The count rides in the title so a folded section still says
               how much is behind it, and an open one costs nothing to read. -->
          <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-toned">
            {{ section.name }}<span v-if="section.entries.length" class="num font-normal text-muted"> ({{ section.entries.length }})</span>
          </h2>
          <!-- The total keeps its room on a narrow screen and the meal name
               gives way instead — a name is guessable from its first word, a
               truncated total is not. -->
          <span class="num shrink-0 text-xs text-muted">{{ round(section.totals.kcal) }} kcal</span>
        </button>
      </header>

      <!-- Folded away rather than hidden in place: a row carries a swipe, a
           field and its own timers, and none of that should be sitting behind
           a closed section. The card's own rules round off and unborder
           whatever child comes last, so a section with nothing under its header
           — folded, or a meal not eaten yet — still looks like a finished card. -->
      <template v-if="!isCollapsed(section.id)">
        <EntryRow
          v-for="entry in section.entries"
          :key="entry.id"
          :entry="entry"
        />
      </template>
    </section>
  </div>
</template>
