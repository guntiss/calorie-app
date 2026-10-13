<script setup lang="ts">
import type { DayFood } from '~/stores/dayLog'

const open = defineModel<boolean>('open', { required: true })

const store = useDayLogStore()
const library = useFoodLibraryStore()
const toast = useToast()
const lastMeal = useLastMeal()

/**
 * How long a save's confirmation stays up.
 *
 * Shorter than the usual toast: a meal is several of these in a row and they
 * should not pile up over the list being picked from.
 */
const CONFIRM_MS = 3000

/**
 * Toasts go to the top of the screen while this modal is up.
 *
 * The modal opens with the cursor in the weight box, so on a phone the keypad
 * is over the bottom of the viewport from the moment it appears — which is
 * exactly where a toast would otherwise land, behind the keyboard and unseen.
 */
const toaster = useToastPosition()

/**
 * The sheet is sized against what is on screen, not against the window.
 *
 * It opens with the cursor in the weight box, so the keypad is up from the
 * moment it appears — and on iOS that takes nothing off `100dvh`. Watched here
 * rather than in the modal's own markup because the measurement is published as
 * CSS variables the whole document can read; see `.fits-viewport` in main.css.
 */
useViewportFit()

/**
 * The meal the row lands in.
 *
 * Held here rather than passed in: the day has one button that opens this, so
 * which meal is meant is a question the modal asks instead of one it is
 * answered before it opens. Starts on the meal the clock says it is, unless
 * another was picked by hand earlier in the same part of the day.
 */
const mealId = ref<string | undefined>()

/** The meals to choose between, as the radio row shows them. */
const mealItems = computed(() => store.meals.map(meal => ({ label: meal.name, value: meal.id })))

/** What the chosen meal is called, for the line the confirmation says it on. */
const mealName = computed(() => store.meals.find(meal => meal.id === mealId.value)?.name ?? 'food')

/**
 * The meal the modal opens on.
 *
 * On today: a meal picked by hand in this part of the day, else the one the
 * time of day names. On any other day the clock says nothing about what was
 * eaten when, so the last meal picked stands in. The first meal when none of
 * these turns up anything.
 *
 * Stored ids are checked against the meals actually on the day: meals can be
 * renamed and removed, and a row pointing at one that is gone would leave the
 * radios with nothing selected and Save with nowhere to put the food.
 */
function startingMeal() {
  const exists = (id: string | null): id is string => !!id && store.meals.some(meal => meal.id === id)
  if (store.date === todayIso()) {
    const picked = lastMeal.readCurrent()
    if (exists(picked)) return picked
    const timed = mealForSlot(store.meals, mealSlotAt(new Date()))
    if (timed) return timed.id
  }
  const stored = lastMeal.read()
  if (exists(stored)) return stored
  return store.meals[0]?.id
}

/**
 * What the row weighs, in grams.
 *
 * Empty to start with: a weight is read off a scale, and a number already in
 * the box is one to notice and clear rather than one to trust.
 */
const quantity = ref<NumericValue>('')

/** What narrows the list. Not a name for the row: the food chosen below is. */
const query = ref('')

/**
 * What Save will log: a food from the library, or a name the library has never
 * heard of and is about to gain.
 *
 * Null means nothing has been picked — and then a typed query stands in for
 * one, so a name can be added without first tapping the row offering to.
 */
const choice = ref<DayFood | string | null>(null)

const saving = ref(false)

/** Whether the camera dialog is up. */
const scanning = ref(false)

/**
 * A code that was scanned and that no food answers to yet.
 *
 * Held so that it can go onto whatever is logged next — the food typed in
 * after it, or the one picked off the list because that is what the packet
 * turned out to be. Cleared as soon as it has been used, or waved away.
 */
const scanned = ref<string | null>(null)

/** Whether the server is being asked about a code the device did not know. */
const looking = ref(false)

/**
 * Whether there is nothing to show and a reason to expect there will be.
 *
 * Only ever true on a first visit, or in a browser that has been cleared: the
 * library is kept on the device, so every visit after the first opens onto the
 * full list while the refresh happens behind it.
 */
const loading = computed(() => library.fetching && !library.foods.length)

/**
 * Whether the weight has been typed into since the save in flight left with it.
 *
 * Comparing the value before and after would not do: the next food is very
 * often the same 100 g, and a weight typed again while the last save is still
 * in the air must not be cleared by that save landing.
 */
const weightTyped = ref(false)

const search = useTemplateRef<{ inputRef: HTMLInputElement | null }>('search')
const weight = useTemplateRef<{ focus: () => void }>('weight')
const panel = useTemplateRef<HTMLElement>('panel')

/**
 * The library as the list shows it, and where the query landed in each row.
 *
 * Searched on the device against the copy held there, so the list narrows on
 * the keystroke rather than on the response to it — and so accents are
 * something the library has rather than something you have to type: "tumsa"
 * finds "tumšā".
 */
const visible = computed(() => library.search(query.value))

/** The typed name, when the library has nothing already called that. */
const newName = computed(() => {
  const typed = query.value.trim()
  if (!typed) return null
  return visible.value.some(m => m.food.name.toLowerCase() === typed.toLowerCase()) ? null : typed
})

/** What would be logged right now, whether or not a row was actually tapped. */
const pending = computed(() => choice.value ?? (query.value.trim() || null))

/**
 * Whether there is a row to save: a food, and a weight to go with it.
 *
 * A row without a weight is a food with no calories against it, which is a
 * blank in the day rather than an entry in it — so the weight is asked for
 * here, while the box is still on screen, instead of being chased later from
 * the grid. Zero is no more a weight than an empty box is.
 */
const ready = computed(() => !!pending.value && quantity.value !== '' && quantity.value > 0)

function isChosen(food: DayFood) {
  return typeof choice.value === 'object' && choice.value?.id === food.id
}

// --- the library ----------------------------------------------------------

let debounce: ReturnType<typeof setTimeout> | null = null

function onQuery() {
  // Typing is a search, not a choice: whatever was picked before stops being
  // what Save means the moment the list under it changes.
  choice.value = null

  // The list has already narrowed by now — it is searched here, against the
  // copy on the device. This is only for a library too big to hold all of:
  // the server is asked about what was typed, and the answer joins the copy.
  if (!library.truncated) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => library.reach(query.value), 200)
}

// --- scanning -------------------------------------------------------------

/**
 * What a scanned code means for the form.
 *
 * A code the library knows is a food chosen — the whole point of holding a
 * phone over a packet — so the query is cleared and the row selected, leaving
 * only the weight to type. A code nothing answers to is kept instead, and goes
 * onto whatever is logged next.
 */
async function onScanned(code: string) {
  choice.value = null
  query.value = ''

  looking.value = true
  const found = await library.lookup(code)
  looking.value = false

  if (!found) {
    scanned.value = code
    // The cursor goes to the name box, because naming it is what is left to do.
    search.value?.inputRef?.focus()
    return
  }

  scanned.value = null
  choice.value = found
  takeFocus()
  // The list is the whole library, so the food that was scanned is very likely
  // below the fold — a row selected off screen looks like nothing happened.
  void nextTick(() => {
    const at = visible.value.findIndex(m => m.food.id === found.id)
    if (at !== -1) panel.value?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'center' })
  })
}

/**
 * Put a scanned code onto the food that was just logged.
 *
 * Only ever fills a blank: a food already carrying a code has been scanned or
 * typed into before, and a packet in front of us now is no reason to overwrite
 * what someone put there. Done after the row is saved, so the log never waits
 * on it.
 */
async function attachBarcode(foodId: string, code: string) {
  const food = library.foods.find(f => f.id === foodId)
  if (!food || food.barcode) return

  try {
    const saved = await $fetch<DayFood>(`/api/foods/${foodId}`, {
      method: 'PATCH',
      body: { barcode: code }
    })
    library.upsert(saved)
    store.rememberFood(saved)
  } catch {
    // The row is logged, which is what was asked for. The code can be put on
    // the food from its own dialog later.
  }
}

// --- saving ---------------------------------------------------------------

/**
 * Log what is on the form.
 *
 * `again` keeps the modal open with the amount reset and the search cleared,
 * because a meal is usually several foods and each one is a fresh choice.
 */
async function save(again: boolean) {
  const food = pending.value
  const grams = quantity.value
  if (!ready.value || !food || grams === '' || saving.value) return

  // What the form held when the save left, so that clearing it afterwards
  // clears only what was saved. A new food may already be being entered by the
  // time the last one lands — the library is a round trip away — and typing it
  // must not be wiped out from under the fingers that typed it.
  const sent = { choice: choice.value, query: query.value }
  // Taken before the save so that a code scanned for the *next* food, while
  // this one is still in the air, is not the one written onto this one.
  const code = scanned.value
  scanned.value = null
  weightTyped.value = false

  saving.value = true
  const entry = await store.logFood(mealId.value ?? null, food, grams)
  saving.value = false

  if (!entry) {
    // Nothing was logged, so the code has nothing to go on yet — it stays on
    // the form for the retry, unless another packet has been scanned since,
    // which is then the one that counts.
    if (!scanned.value) scanned.value = code
    toast.add({
      title: 'Could not log that',
      description: store.error ?? undefined,
      color: 'error'
    })
    return
  }

  if (code && entry.foodId) void attachBarcode(entry.foodId, code)

  if (!again) {
    open.value = false
    return
  }

  // The modal stays open and the form empties itself, which on its own looks
  // much like a save that never happened — so the row that was logged says so
  // on its way out.
  toast.add({
    title: `Added ${entry.nameSnapshot ?? 'food'}`,
    description: `${grams} g · ${mealName.value.toLowerCase()}`,
    icon: 'i-lucide-check',
    color: 'success',
    duration: CONFIRM_MS
  })

  const untouched = query.value === sent.query
  if (choice.value === sent.choice) choice.value = null
  if (untouched) query.value = ''
  if (!weightTyped.value) quantity.value = ''
  // The library may have just gained the food that was typed, and the tally the
  // list is ordered by has moved either way. Behind the list rather than over
  // it: what is on screen is right enough to keep picking from meanwhile.
  void library.sync()
  // Only when the form is genuinely empty again: taking focus while the next
  // food is being typed would move the cursor out of the box holding it.
  if (untouched) takeFocus()
}

/**
 * A meal picked by hand.
 *
 * Remembered as soon as it is picked, not when something is saved: closing the
 * modal without logging anything still says which meal was meant. Only a tap
 * counts — the meal the modal opened on was a guess, and storing it would turn
 * the guess into a pick that outlasts the clock moving on.
 */
function pickMeal(id: string | undefined) {
  mealId.value = id
  lastMeal.remember(id ?? null)
}

// --- opening --------------------------------------------------------------

/**
 * Where the cursor goes: the weight box, on a phone as much as on a desktop.
 *
 * A row is a weight and a food, and the weight is the half only this row knows
 * — the food is picked off the list below, so the box that has to be typed
 * into is the one that opens ready for it. On a phone this raises the keypad
 * over the lower part of the list, which is the price of not needing a tap
 * before the first digit; the list scrolls behind it.
 */
function takeFocus() {
  weight.value?.focus()
}

/** Whether this modal is one of the screens currently holding toasts up. */
let raised = false

// Reset on the way in rather than on the way out, so a modal reopened after a
// save never shows what was typed into it last time.
watch(open, (isOpen) => {
  if (!isOpen) {
    // Held up for a beat past closing: a meal often ends with Save & next and
    // then Save & close a second later, so the confirmation from the one before
    // is still on screen — and a toast that jumps mid-sentence is worse than one
    // left high for a moment.
    if (raised) toaster.lower(CONFIRM_MS)
    raised = false
    return
  }

  if (!raised) toaster.raise()
  raised = true

  mealId.value = startingMeal()
  quantity.value = ''
  weightTyped.value = false
  query.value = ''
  choice.value = null
  scanned.value = null
  // The list is already there, held on the device; this only catches it up on
  // whatever was logged or corrected elsewhere since.
  void library.sync()
  void nextTick(takeFocus)
}, { immediate: true })

onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
  // The day unmounts this modal as it closes, so this is the usual way out —
  // the watcher above is stopped by then. Same beat's grace either way.
  if (raised) toaster.lower(CONFIRM_MS)
  raised = false
})

// --- keyboard -------------------------------------------------------------

/** Step the choice through the list, so it can be picked without a pointer. */
function move(delta: number) {
  const list = visible.value
  if (!list.length) return

  const current = list.findIndex(m => isChosen(m.food))
  const next = current === -1
    ? (delta > 0 ? 0 : list.length - 1)
    : (current + delta + list.length) % list.length

  choice.value = list[next]?.food ?? null
  panel.value?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <!-- A tall sheet rather than a box that grows: the list is meant to run to
       the bottom of the modal whether the library has four foods in it or
       forty, so the height is fixed and the list is what gives inside it.
       Short of the full height on a phone — a sheet with the day showing above
       and below it reads as something opened over the day rather than a screen
       the app has navigated to, and the room it gives back is room the keypad
       wants anyway. -->
  <UModal
    v-model:open="open"
    :title="'Log food'"
    :content="{ onOpenAutoFocus: (event: Event) => event.preventDefault() }"
    :ui="{
      content: 'fits-viewport',
      body: 'flex min-h-0 flex-col overflow-y-hidden'
    }"
  >
    <template #body>
      <!-- `autocomplete` is off here as well as on the fields: Safari reads a
           group of inputs as a whole when it guesses that it is being asked for
           someone's details. The ref is for scrolling the list, not for focus —
           the weight box takes that. -->
      <div
        ref="panel"
        autocomplete="off"
        class="flex min-h-0 flex-1 flex-col gap-3"
      >
        <!-- Both halves of a row on one line: the weight is a few digits and
             does not need a line of its own, and every millimetre it gives back
             is another food visible on the list below. The weight comes first
             because it is the part only this row knows — the food is picked
             from a list, the weight is read off a scale. -->
        <div class="flex items-start gap-2">
          <UFormField label="Weight" required class="w-16 shrink-0">
            <!-- The default room for a trailing icon is far more than a single
                 "g" needs, and in a field this narrow it would be taken off the
                 digits. -->
            <NumberInput
              ref="weight"
              v-model="quantity"
              class="w-full"
              :ui="{ base: 'pe-5', trailing: 'pe-1.5' }"
              @input="weightTyped = true"
              @keydown.enter.prevent="search?.inputRef?.focus()"
            >
              <template #trailing>
                <span class="text-xs text-dimmed">g</span>
              </template>
            </NumberInput>
          </UFormField>

          <!-- Labelled "Food" rather than "Name": iOS reads a field's label,
               placeholder and name attribute to guess what belongs in it, and
               the word "name" alone is enough to put "AutoFill Contact" over
               the keyboard and offer the person's own name for a food. -->
          <UFormField label="Food" class="min-w-0 flex-1">
            <UInput
              ref="search"
              v-model="query"
              name="food"
              autocomplete="off"
              icon="i-lucide-search"
              placeholder="Search or add a food"
              class="w-full"
              :ui="{ base: 'pe-8', trailing: 'pe-1' }"
              @input="onQuery"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="save(false)"
            >
              <!-- Inside the field rather than beside it: on a phone the row
                   is already a weight and a name, and a third box would take
                   the room off the one being typed into. -->
              <template #trailing>
                <UButton
                  :icon="looking ? 'i-lucide-loader-circle' : 'i-lucide-scan-barcode'"
                  :class="looking ? 'animate-spin' : ''"
                  color="neutral"
                  variant="link"
                  size="xs"
                  aria-label="Scan a barcode"
                  class="p-0"
                  @click="scanning = true"
                />
              </template>
            </UInput>
          </UFormField>
        </div>

        <!-- A code nothing in the library answers to. Said plainly, because
             what happens next is not obvious from the form alone: the food
             logged from here — typed in fresh, or picked off the list because
             that is what the packet turned out to be — is the one that gains
             it. Nothing is written until something is actually logged. -->
        <div
          v-if="scanned"
          class="flex items-center gap-2 rounded-lg border border-default bg-elevated/40 px-3 py-2 text-xs"
        >
          <UIcon name="i-lucide-scan-barcode" class="size-4 shrink-0 text-primary" />
          <span class="min-w-0 flex-1">
            <span class="num">{{ scanned }}</span> is new —
            <span class="text-dimmed">it goes on the food you log next.</span>
          </span>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Forget this barcode"
            class="shrink-0"
            @click="scanned = null"
          />
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-1.5">
          <!-- The list runs to the bottom of the modal: everything the library
               has is already here, so the usual food is a tap rather than a
               search. `overscroll-contain` keeps a flick at either end inside
               the list instead of dragging the day behind it. -->
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-default">
            <!-- Offered first, where a name typed into the box is going to be
                 looked for: nothing in the library answers to it yet. -->
            <button
              v-if="newName"
              type="button"
              class="flex w-full items-center gap-2 rounded-t-[7px] border-b border-default px-3 py-2.5
                     text-left text-sm transition-colors hover:bg-elevated"
              :aria-pressed="choice === newName"
              :class="choice === newName ? 'bg-elevated ring-1 ring-inset ring-primary' : ''"
              @click="choice = newName"
            >
              <UIcon name="i-lucide-plus" class="size-4 shrink-0 text-primary" />
              <span class="truncate">Add <span class="font-medium">{{ newName }}</span> as a new food</span>
            </button>

            <!-- What the query matched is marked in the row, so a screen of
                 names that all begin the same way can be read at a glance
                 rather than compared word by word — and so a row that came up
                 for an accent nobody typed says which letters answered. -->
            <button
              v-for="(match, index) in visible"
              :key="match.food.id"
              type="button"
              :data-index="index"
              :data-food-name="match.food.name"
              :aria-pressed="isChosen(match.food)"
              class="flex w-full items-baseline justify-between gap-2 border-b border-default/60 px-3 py-2.5
                     text-left text-sm transition-colors first:rounded-t-[7px] last:rounded-b-[7px]
                     last:border-b-0 hover:bg-elevated"
              :class="isChosen(match.food) ? 'bg-elevated ring-1 ring-inset ring-primary' : ''"
              @click="choice = match.food"
            >
              <span class="truncate">
                <HighlightedText :text="match.food.name" :ranges="match.name" />
                <span v-if="match.food.brand" class="text-dimmed">
                  · <HighlightedText :text="match.food.brand" :ranges="match.brand" />
                </span>
              </span>
              <span class="num shrink-0 text-xs text-muted">
                {{ Math.round(match.food.kcal) }} kcal/100g
              </span>
            </button>

            <!-- An empty list is only worth saying so about once there is
                 something to conclude from it. With a copy of the library on
                 the device that is nearly always at once; on a first visit it
                 waits for the library to actually answer, because "no foods
                 yet" for a library full of them reads as one that has been
                 lost. -->
            <div v-if="loading && !visible.length && !newName" class="grid place-items-center py-6">
              <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-dimmed" />
            </div>

            <p v-else-if="!visible.length && !newName" class="px-3 py-6 text-center text-sm text-dimmed">
              No foods yet. Type a name and it lands in your library.
            </p>
          </div>
        </div>

        <!-- The meal sits at the foot of the form, against the buttons that
             act on it: it is the one thing here that is usually already right
             — the modal opens on the meal the clock says it is — so it belongs
             where it can be read on the way to Save rather than in front of
             the weight and the food, which are what there is to type. Reads as
             one filled segment among four rather than as a question with a
             label over it. Still radios underneath: the dot is what is hidden,
             not the control, so the row is one stop on a keyboard and the
             arrows step through it.

             Spread across the width because there is no better use for the
             room, and an even row of segments is a shape the eye takes in whole
             — four names to compare rather than four things to read. -->
        <URadioGroup
          :model-value="mealId"
          :items="mealItems"
          @update:model-value="pickMeal"
          orientation="horizontal"
          variant="card"
          indicator="hidden"
          size="sm"
          :ui="{
            fieldset: 'w-full gap-1',
            item: `group flex-auto min-w-0 justify-center rounded-lg border-default px-2 py-1.5
                   cursor-pointer transition-colors hover:bg-elevated
                   has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary
                   has-[[data-state=checked]]:hover:bg-primary
                   has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary`,
            label: 'truncate text-sm font-medium group-has-[[data-state=checked]]:text-inverted'
          }"
        />
      </div>

      <BarcodeScanner v-model:open="scanning" @detected="onScanned" />
    </template>

    <template #footer>
      <!-- One row, so the footer costs a single line of the sheet and the list
           above it keeps the rest. The two saves share what Cancel leaves:
           adding another is the button a meal of several foods presses over and
           over, so it is as wide as the one that closes. -->
      <div class="flex w-full items-center gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton
          class="flex-1 justify-center"
          variant="soft"
          icon="i-lucide-plus"
          label="Save & next"
          :disabled="!ready || saving"
          @click="save(true)"
        />
        <UButton
          class="flex-1 justify-center"
          label="Save & close"
          :loading="saving"
          :disabled="!ready || saving"
          @click="save(false)"
        />
      </div>
    </template>
  </UModal>
</template>
