<script setup lang="ts">
const store = useDayLogStore()

const emit = defineEmits<{ log: [] }>()

const kcal = computed(() => store.totals.total.kcal)
const goal = computed(() => store.goal.kcal)
const remaining = computed(() => goal.value - kcal.value)

/** Past the goal at all — which is what the number says. */
const past = computed(() => store.hasGoal && kcal.value > goal.value)

/** Far enough past it to be worth colouring — see `isOverGoal`. */
const over = computed(() => isOverGoal(kcal.value, goal.value))

/** Clamped so an overshoot stays in its track — the number says how far over. */
const kcalPct = computed(() =>
  store.hasGoal ? Math.min((kcal.value / goal.value) * 100, 100) : 0
)

const fmt = (n: number) => Math.round(n).toLocaleString()
</script>

<template>
  <div class="sticky bottom-0 z-20 border-t border-default/60 bg-default/70 backdrop-blur-xl">
    <!-- Two columns: the day's numbers, and the one button that changes them.
         The button is the full height of the numbers rather than floating over
         them, so nothing is ever hidden underneath it. -->
    <div
      class="mx-auto flex w-full max-w-2xl items-center gap-3 px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]"
    >
      <div class="min-w-0 flex-1">
        <!-- Calories are what the day is judged by, so they get the one big
             number here; the macros below are read at a glance or not at all. -->
        <div class="flex items-baseline gap-1.5">
          <span
            class="num text-2xl leading-none font-semibold"
            :class="over ? 'text-error' : 'text-highlighted'"
          >{{ fmt(store.hasGoal ? Math.abs(remaining) : kcal) }}</span>
          <span class="text-xs text-muted">
            {{ store.hasGoal ? (past ? 'over' : 'left') : 'kcal' }}
          </span>

          <span v-if="store.hasGoal" class="num ml-auto shrink-0 text-[11px] text-dimmed">
            {{ fmt(kcal) }} / {{ fmt(goal) }} kcal
          </span>
          <ULink v-else to="/settings" class="ml-auto shrink-0 text-[11px] text-muted">
            Set a daily goal
          </ULink>
        </div>

        <div v-if="store.hasGoal" class="mt-1.5 h-2 overflow-hidden rounded-full bg-accented">
          <div
            class="h-full transition-all duration-200"
            :class="over ? 'bg-error' : 'bg-primary'"
            :style="{ width: `${kcalPct}%` }"
          />
        </div>

        <div class="mt-2 grid grid-cols-3 gap-2.5">
          <MacroMeter
            label="Protein"
            :total="store.totals.total.protein"
            :goal="store.goal.protein"
            unit="g"
          />
          <MacroMeter
            label="Fat"
            :total="store.totals.total.fat"
            :goal="store.goal.fat"
            unit="g"
          />
          <MacroMeter
            label="Carbs"
            :total="store.totals.total.carbs"
            :goal="store.goal.carbs"
            unit="g"
          />
        </div>
      </div>

      <!-- The one way onto the day, parked in the corner the thumb rests in.
           No label: a plus on the day's own footer is not ambiguous, and the
           width it saves is what lets the numbers keep their own line. -->
      <UButton
        icon="i-lucide-plus"
        color="primary"
        variant="solid"
        aria-label="Log food"
        class="size-14 shrink-0 justify-center rounded-full shadow-lg shadow-primary/25"
        :ui="{ leadingIcon: 'size-7' }"
        @click="emit('log')"
      />
    </div>
  </div>
</template>
