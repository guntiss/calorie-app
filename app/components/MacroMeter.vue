<script setup lang="ts">
const props = defineProps<{
  label: string
  total: number
  goal: number
  unit?: string
}>()

const hasGoal = computed(() => props.goal > 0)
const remaining = computed(() => props.goal - props.total)

/** Past the goal at all — which is what the number says. */
const past = computed(() => hasGoal.value && props.total > props.goal)

/** Far enough past it to be worth colouring — see `isOverGoal`. */
const over = computed(() => isOverGoal(props.total, props.goal))

/** The bar is a percentage of the goal, clamped so an overshoot stays in its track. */
const totalPct = computed(() =>
  hasGoal.value ? Math.min((props.total / props.goal) * 100, 100) : 0
)

const fmt = (n: number) => Math.round(n).toLocaleString()
</script>

<template>
  <!-- One of three side by side in a column the footer's plus button has taken a
       bite out of, so everything here is written to survive a narrow measure:
       the label truncates, the number never does. -->
  <div class="min-w-0">
    <div class="flex items-baseline justify-between gap-1">
      <span class="truncate text-[11px] font-medium text-muted">{{ label }}</span>
      <span
        class="num shrink-0 text-[11px]"
        :class="over ? 'font-semibold text-error' : 'text-toned'"
      >
        <template v-if="hasGoal">{{ past ? `+${fmt(-remaining)}` : fmt(remaining) }}{{ unit }}</template>
        <template v-else>{{ fmt(total) }}{{ unit }}</template>
      </span>
    </div>

    <div
      v-if="hasGoal"
      class="mt-1 h-1.5 overflow-hidden rounded-full bg-accented"
    >
      <div
        class="h-full transition-all duration-200"
        :class="over ? 'bg-error' : 'bg-primary'"
        :style="{ width: `${totalPct}%` }"
      />
    </div>

    <div class="num mt-0.5 truncate text-[10px] text-dimmed">
      {{ fmt(total) }}<template v-if="hasGoal"> / {{ fmt(goal) }}</template>{{ unit }}
    </div>
  </div>
</template>
