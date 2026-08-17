<script setup lang="ts">
const toast = useToast()
const { public: { appVersion } } = useRuntimeConfig()

type Split = Record<'protein' | 'fat' | 'carbs', NumericValue>

const mode = ref<'grams' | 'percent'>('grams')
// The fields hand back `''` when cleared, which is a field not yet filled in
// rather than a goal of zero — `stated` below is where it becomes a number.
const kcal = ref<NumericValue>(2000)
const grams = reactive<Split>({ protein: 150, fat: 67, carbs: 200 })
const percent = reactive<Split>({ protein: 30, fat: 30, carbs: 40 })
const saving = ref(false)

const { data } = await useFetch('/api/goals', { query: { date: todayIso() } })

/** A first goal is backfilled over days already logged; later ones are not. */
const isFirstGoal = ref(!data.value?.goal)

if (data.value?.goal) {
  const goal = data.value.goal
  mode.value = goal.inputMode
  kcal.value = goal.kcal
  grams.protein = round(goal.protein)
  grams.fat = round(goal.fat)
  grams.carbs = round(goal.carbs)
  percent.protein = round(goal.proteinPct ?? 0)
  percent.fat = round(goal.fatPct ?? 0)
  percent.carbs = round(goal.carbsPct ?? 0)
}

function round(n: number) {
  return Math.round(n * 10) / 10
}

/** A field left empty stands for the zero it looks like, once the maths starts. */
function stated(value: NumericValue): number {
  return value === '' ? 0 : value
}

const gramsSaid = computed(() => ({
  protein: stated(grams.protein),
  fat: stated(grams.fat),
  carbs: stated(grams.carbs)
}))

const percentSaid = computed(() => ({
  protein: stated(percent.protein),
  fat: stated(percent.fat),
  carbs: stated(percent.carbs)
}))

/** The two modes are two views of one goal, so each edit updates the other side. */
watch([kcal, percentSaid], () => {
  if (mode.value !== 'percent') return
  const derived = goalsFromPercent(stated(kcal.value), percentSaid.value)
  grams.protein = round(derived.protein)
  grams.fat = round(derived.fat)
  grams.carbs = round(derived.carbs)
})

watch([kcal, gramsSaid], () => {
  if (mode.value !== 'grams') return
  const derived = goalsToPercent({ kcal: stated(kcal.value), ...gramsSaid.value })
  percent.protein = round(derived.protein)
  percent.fat = round(derived.fat)
  percent.carbs = round(derived.carbs)
})

const percentTotal = computed(() => {
  const said = percentSaid.value
  return round(said.protein + said.fat + said.carbs)
})

/** Grams entered directly rarely sum to exactly the kcal goal; show the gap. */
const impliedKcal = computed(() => Math.round(kcalFromMacros(gramsSaid.value)))

async function save() {
  saving.value = true
  try {
    await $fetch('/api/goals', {
      method: 'PUT',
      body: {
        effectiveFrom: todayIso(),
        kcal: stated(kcal.value),
        ...gramsSaid.value,
        inputMode: mode.value,
        proteinPct: percentSaid.value.protein,
        fatPct: percentSaid.value.fat,
        carbsPct: percentSaid.value.carbs
      }
    })
    toast.add({
      title: 'Goal saved',
      description: isFirstGoal.value
        ? 'Applies from today, and to the days you logged before it.'
        : 'Applies from today onwards.',
      color: 'success'
    })
    isFirstGoal.value = false
  } catch (e) {
    toast.add({ title: 'Could not save', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md px-4 pb-16">
    <header class="flex items-center gap-2 py-3">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/" aria-label="Back" />
      <h1 class="text-lg font-semibold">
        Daily goal
      </h1>
    </header>

    <UFormField label="Calories" class="mb-4">
      <NumberInput v-model="kcal" integer size="lg" class="w-full">
        <template #trailing>
          <span class="text-xs text-dimmed">kcal</span>
        </template>
      </NumberInput>
    </UFormField>

    <UTabs
      v-model="mode"
      :items="[
        { label: 'Grams', value: 'grams' },
        { label: 'Percent', value: 'percent' }
      ]"
      class="mb-4"
    />

    <div v-if="mode === 'grams'" class="space-y-3">
      <UFormField v-for="key in (['protein', 'fat', 'carbs'] as const)" :key="key" :label="key" class="capitalize">
        <NumberInput v-model="grams[key]" class="w-full">
          <template #trailing>
            <span class="text-xs text-dimmed">g · {{ round(percentSaid[key]) }}%</span>
          </template>
        </NumberInput>
      </UFormField>

      <p class="text-xs" :class="Math.abs(impliedKcal - stated(kcal)) > 25 ? 'text-warning' : 'text-dimmed'">
        These macros come to {{ impliedKcal.toLocaleString() }} kcal.
      </p>
    </div>

    <div v-else class="space-y-3">
      <UFormField v-for="key in (['protein', 'fat', 'carbs'] as const)" :key="key" :label="key" class="capitalize">
        <NumberInput v-model="percent[key]" class="w-full">
          <template #trailing>
            <span class="text-xs text-dimmed">% · {{ round(gramsSaid[key]) }}g</span>
          </template>
        </NumberInput>
      </UFormField>

      <p class="text-xs" :class="Math.abs(percentTotal - 100) > 0.5 ? 'text-warning' : 'text-dimmed'">
        Split totals {{ percentTotal }}%.
      </p>
    </div>

    <UButton
      block
      size="lg"
      class="mt-6"
      :loading="saving"
      label="Save goal"
      @click="save"
    />

    <p class="mt-3 text-center text-xs text-dimmed">
      <template v-if="isFirstGoal">
        Your first goal also covers the days you logged before today.
      </template>
      <template v-else>
        Saved goals apply from today, so past days keep the goal they were logged under.
      </template>
    </p>

    <p v-if="appVersion" class="mt-8 text-center text-xs text-dimmed">
      Version {{ appVersion }}
    </p>
  </div>
</template>
