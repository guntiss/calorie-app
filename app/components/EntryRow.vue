<script setup lang="ts">
import { UNDO_WINDOW_MS, type GridEntry } from '~/stores/dayLog'

const props = defineProps<{ entry: GridEntry }>()

const store = useDayLogStore()
const toast = useToast()

const food = computed(() => props.entry.foodId ? store.foodCache.get(props.entry.foodId) : undefined)

/** A row whose food has no numbers on it — so the low total has a visible cause. */
const incomplete = computed(() => store.isIncomplete(props.entry))

/** Open while the food behind this row is being corrected. */
const editing = ref(false)

/**
 * Whether the row still counts towards the day.
 *
 * Reached by dragging the row to the right — see the swipe below. A row's food
 * is fixed once it has one, and the wrong food is taken back by removing the
 * row rather than renaming it, so the row has no tap of its own to spend on
 * anything else and this can have the whole of it.
 */
function toggleCounted() {
  store.updateEntry(props.entry.id, { counted: !props.entry.counted })
}

/**
 * Edit the food behind the row.
 *
 * Macros belong to the food, not to the row that logs it, so this is the one
 * place the day's numbers are corrected — and every row has a food to correct,
 * because a row that names nothing is not yet logged.
 */
function edit() {
  if (food.value) editing.value = true
}

/**
 * The quantity as its field holds it, where an empty field means no quantity
 * yet rather than a quantity of zero.
 *
 * The field itself is text: a phone whose region writes 12,5 gets a comma on
 * its decimal keypad, and a `type="number"` input drops it — see
 * `~/utils/numeric`.
 */
const quantity = computed<NumericValue>({
  get: () => props.entry.quantity ?? '',
  set: value => store.updateEntry(props.entry.id, { quantity: value === '' ? null : value })
})

const { raw: quantityText, onInput: onQuantityInput } = useNumericField(quantity)

/**
 * Delete the row, then offer it back for as long as the store will hold it.
 *
 * The toast outlives this component — it is rendered by the app-level toaster —
 * so removing the row and announcing it in the same breath is safe.
 */
function remove() {
  const { id, nameSnapshot } = props.entry
  store.removeEntry(id)

  toast.add({
    title: nameSnapshot ? `Removed ${nameSnapshot}` : 'Removed row',
    icon: 'i-lucide-trash-2',
    color: 'neutral',
    orientation: 'horizontal',
    duration: UNDO_WINDOW_MS,
    actions: [{
      label: 'Undo',
      color: 'neutral',
      variant: 'outline',
      onClick: () => store.undoRemove(id)
    }]
  })
}

/* --- swipe the row ---------------------------------------------------------
 *
 * The row is dragged aside rather than aimed at: on a phone a control this size
 * sits a thumb's width from the quantity beside it. Which way it goes says what
 * happens on release — left removes the row, right switches whether it counts —
 * and both are cheap to trigger because both are cheap to take back: the
 * removal from its toast, the count with the same swipe again.
 *
 * The row itself carries nothing tappable but its own controls, so a food is
 * never changed by a finger that meant to scroll past it.
 *
 * Pointer events rather than touch ones, so a mouse drag does the same thing.
 */

/** How far the row has to travel before letting go acts on it. */
const SWIPE_THRESHOLD = 72
/** Past this the row stops following, so an overlong drag says nothing extra. */
const SWIPE_MAX = 120
/** Long enough to read as the row leaving, short enough not to hold up the undo. */
const EXIT_MS = 160

const row = useTemplateRef<HTMLElement>('row')

/** How far the row currently sits from home. Negative is left, 0 is at rest. */
const offset = ref(0)
/** The finger is on the row: it follows exactly, with no transition of its own. */
const dragging = ref(false)
/** The row is animating — sliding home, or out. The panel stays lit for it. */
const settling = ref(false)

/**
 * Which way this swipe went: -1 left, 1 right, 0 for no swipe in progress.
 *
 * Held rather than read off the offset, because the row passes back through
 * zero on its way home and the panel behind it must not blink out mid-flight.
 */
const direction = ref(0)

const armed = computed(() => Math.abs(offset.value) >= SWIPE_THRESHOLD)
/** Whether a panel behind the row is uncovered, and so worth rendering. */
const revealed = computed(() => direction.value !== 0)

/** Tracks one drag from the pointer that started it. */
let pointerId: number | null = null
let startX = 0
let startY = 0
let engaged = false
/** Set by a drag so the release that ends it does not also count as a tap. */
let swiped = false
let settleTimer: ReturnType<typeof setTimeout> | null = null

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return

  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  engaged = false

  // The same press, watched for the other thing it could turn into: held still,
  // it picks the row up instead. Only one of the two can have it, and moving is
  // what decides — see `useEntryDrag`.
  drag.press(event, props.entry.id)
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerId !== pointerId) return
  // The row is held, waiting to be put somewhere; sideways is not what this
  // press is any more.
  if (lifted.value) return

  const dx = event.clientX - startX
  const dy = event.clientY - startY

  if (!engaged) {
    // Wait for the gesture to declare itself. A scroll — anything with more
    // vertical in it than horizontal — is given up on for the rest of the touch
    // rather than fought over.
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dy) > 10) return cancelDrag()
    if (Math.abs(dx) < 8) return

    engaged = true
    dragging.value = true
    settling.value = false
    // The row keeps receiving the drag even once the finger leaves it, and a
    // mouse dragged across a row of inputs would otherwise select their labels.
    row.value?.setPointerCapture(event.pointerId)
    getSelection()?.removeAllRanges()
  }

  // Past its limit the row keeps moving, but barely: the drag stays honest
  // about having gone as far as it usefully can.
  const pulled = Math.abs(dx)
  const travel = pulled <= SWIPE_MAX ? pulled : SWIPE_MAX + (pulled - SWIPE_MAX) * 0.2
  offset.value = dx < 0 ? -travel : travel
  direction.value = dx < 0 ? -1 : 1
}

function onPointerUp() {
  if (!engaged) return cancelDrag()

  const acted = armed.value
  const wentLeft = offset.value < 0
  swiped = true
  pointerId = null
  engaged = false
  dragging.value = false

  // Left is the one that does not come back, so it keeps going. Right has said
  // everything it has to say by the time the row is home again.
  if (acted && wentLeft) return slideOut()
  if (acted) toggleCounted()
  settleTo(0)
}

/** Nothing came of this pointer: forget it, and let any partial drag home. */
function cancelDrag() {
  pointerId = null
  if (!engaged) return
  engaged = false
  dragging.value = false
  settleTo(0)
}

function settleTo(value: number) {
  offset.value = value
  settling.value = true
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settling.value = false
    direction.value = 0
  }, 220)
}

/**
 * Take the row the rest of the way out, then delete it.
 *
 * The store drops the row the moment `remove` runs, which unmounts this
 * component — so the slide has to finish first, and nothing here runs after it.
 */
function slideOut() {
  settleTo(-(row.value?.offsetWidth ?? 400))
  setTimeout(remove, EXIT_MS)
}

/** A drag that ends on a control must not also press it. */
function onClickCapture(event: MouseEvent) {
  if (!swiped) return
  swiped = false
  event.stopPropagation()
  event.preventDefault()
}

onBeforeUnmount(() => {
  if (settleTimer) clearTimeout(settleTimer)
})

/* --- move the row somewhere else -------------------------------------------
 *
 * Held rather than grabbed. The row is already dragged sideways by a finger
 * anywhere on it and the day scrolls under one, so there is no direction left
 * for a third gesture to be — but there is a way of pressing that neither of
 * those is, which is not moving. Holding the row picks it up; it can then be
 * put anywhere in the day, in this meal or another.
 *
 * Once it is held it stays put and lit, and the line does the travelling — see
 * `useEntryDrag` for why the row is not the thing that follows the finger.
 */

const drag = useEntryDrag()

/** This row is the one being moved: held out of the day until it is let go. */
const lifted = computed(() => drag.dragging.value === props.entry.id)

/** Which side of this row the drop line is on, if it is on this row at all. */
const dropEdge = computed(() => {
  const target = drag.target.value
  return target && target.entryId === props.entry.id ? target.edge : null
})

// The press that picked the row up is still a press, and lands as a click on
// whatever is under the finger when it is let go. The swipe's own guard is what
// swallows it — the two gestures end the same way.
watch(lifted, up => {
  if (up) swiped = true
})

onBeforeUnmount(() => {
  // The row went out from under the drag: the day was changed, or it was
  // removed by something else. Nothing is left holding the pointer.
  if (lifted.value) drag.cancel()
})

/** Landing in a number cell selects it, so typing replaces rather than appends. */
function selectAll(event: FocusEvent) {
  (event.target as HTMLInputElement).select()
}

const cellClass = 'w-full rounded-md bg-transparent px-0.5 py-1 text-sm num text-right outline-none '
  + 'transition-colors placeholder:text-dimmed hover:bg-elevated '
  + 'focus:bg-elevated focus:ring-1 focus:ring-primary'

const iconButtonClass = 'shrink-0 rounded-md p-1 transition-colors hover:bg-accented '
  + 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'
</script>

<template>
  <!-- Clipped sideways, which is the only way the row moves: it slides out past
       its own left edge. `pan-y` leaves the vertical scroll to the browser and
       keeps the horizontal drag here. -->
  <div
    ref="row"
    :data-entry="entry.id"
    class="group relative overflow-x-clip border-b border-default/60 touch-pan-y"
    :class="[
      !entry.counted ? 'opacity-40' : '',
      // Raised off the card while it is held, so it reads as picked up and out
      // of the order the rest of the rows are still in. Clipped on both axes
      // for as long as it is: the row paints its own background below, and the
      // corners of it have to be the rounded ones.
      lifted ? 'z-10 overflow-clip rounded-lg shadow-lg shadow-black/25 ring-2 ring-primary' : ''
    ]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="cancelDrag"
    @click.capture="onClickCapture"
  >
    <!-- What the row is being dragged off to reveal, and so what letting go
         would do. It brightens once the drag is far enough to do it. -->
    <div
      v-if="revealed"
      aria-hidden="true"
      class="absolute inset-0 flex items-center gap-1.5 px-4 text-sm
             font-medium text-white transition-colors group-last:rounded-b-xl"
      :class="[
        direction < 0
          ? ['justify-end', armed ? 'bg-error' : 'bg-error/50']
          : ['justify-start', armed ? 'bg-primary' : 'bg-primary/50']
      ]"
    >
      <!-- The eye says it on its own: no word for it is shorter than the icon,
           and the row it is about is right there beside it. -->
      <UIcon
        :name="direction < 0
          ? 'i-lucide-trash-2'
          : entry.counted ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :class="[direction < 0 ? 'size-4' : 'size-5', armed ? 'scale-110' : '']"
        class="transition-transform"
      />
      <template v-if="direction < 0">
        Remove
      </template>
    </div>

    <div
      class="relative px-2.5 py-1 group-last:rounded-b-xl"
      :class="[
        // A row raised off the card carries the surface it was on: the card
        // behind it shows through anything less.
        revealed || lifted ? 'bg-default' : 'hover:bg-elevated/60',
        dragging ? 'select-none' : ''
      ]"
      :style="{
        transform: offset ? `translate3d(${offset}px, 0, 0)` : undefined,
        transition: dragging ? 'none' : `transform ${EXIT_MS}ms ease-out, background-color 150ms ease`
      }"
    >
      <div class="flex items-center gap-1.5">
        <!-- Marks the rows that are dragging the day's totals down. -->
        <UIcon
          v-if="incomplete"
          name="i-lucide-triangle-alert"
          class="size-3.5 shrink-0 text-warning"
          title="No macros yet, so the day's totals are low"
        />

        <!-- The food is settled by the time the row exists — it is chosen in
             the modal that logs it — so this is a name, not a field. A row that
             names the wrong food is removed and logged again. The row's own
             kcal sits at the right of the name, against the quantity beside
             it, so a column of them reads straight down — quiet enough to skip
             over when the day is being read a meal at a time and there when one
             row is being asked about. -->
        <div class="flex min-w-0 flex-1 items-baseline gap-1.5 px-1 py-1">
          <div
            data-food
            class="min-w-0 flex-1 truncate text-sm"
            :title="entry.counted ? 'Counted in the total' : 'Not counted'"
          >
            {{ entry.nameSnapshot }}
          </div>
          <span v-if="entry.kcal !== null" class="num shrink-0 text-right text-xs text-dimmed">
            {{ Math.round(entry.kcal) }} kcal
          </span>
        </div>

        <!-- Quantity -->
        <div class="flex w-12 shrink-0 items-center">
          <input
            :value="quantityText"
            type="text"
            inputmode="decimal"
            placeholder="—"
            :class="cellClass"
            @focus="selectAll"
            @input="onQuantityInput"
          >
          <span class="pl-0.5 text-xs text-dimmed">g</span>
        </div>

        <!-- The macros live on the food, so correcting them happens in its form. -->
        <button
          type="button"
          :class="[iconButtonClass, food ? 'text-dimmed hover:text-toned' : 'cursor-not-allowed text-dimmed/40']"
          :disabled="!food"
          :title="food ? 'Edit food' : 'Pick a food first'"
          aria-label="Edit food"
          @click="edit"
        >
          <UIcon name="i-lucide-pencil" class="size-4" />
        </button>

        <!-- Counting and removing are the two swipes above, and moving the row
             is the hold; these are all three for a keyboard, which has no
             gesture to make. Each shows itself when tabbed to. -->
        <button
          type="button"
          data-move="up"
          class="sr-only focus-visible:not-sr-only focus-visible:relative"
          :class="[iconButtonClass, 'text-dimmed hover:text-toned']"
          :aria-label="`Move ${entry.nameSnapshot} up`"
          @click="drag.nudge(entry.id, -1)"
        >
          <UIcon name="i-lucide-arrow-up" class="size-4" />
        </button>

        <button
          type="button"
          data-move="down"
          class="sr-only focus-visible:not-sr-only focus-visible:relative"
          :class="[iconButtonClass, 'text-dimmed hover:text-toned']"
          :aria-label="`Move ${entry.nameSnapshot} down`"
          @click="drag.nudge(entry.id, 1)"
        >
          <UIcon name="i-lucide-arrow-down" class="size-4" />
        </button>

        <button
          type="button"
          class="sr-only focus-visible:not-sr-only focus-visible:relative"
          :class="[iconButtonClass, 'text-dimmed hover:text-toned']"
          :aria-pressed="entry.counted"
          aria-label="Count towards the day"
          @click="toggleCounted"
        >
          <UIcon
            :name="entry.counted ? 'i-lucide-eye' : 'i-lucide-eye-off'"
            class="size-4"
            :class="entry.counted ? 'text-primary' : 'text-dimmed'"
          />
        </button>

        <button
          type="button"
          class="sr-only focus-visible:not-sr-only focus-visible:relative"
          :class="[iconButtonClass, 'text-dimmed hover:text-error']"
          title="Remove"
          aria-label="Remove"
          @click="remove"
        >
          <UIcon name="i-lucide-trash-2" class="size-4" />
        </button>
      </div>
    </div>

    <!-- Where the row being dragged would land. Drawn on the row it would sit
         against rather than in a layer of its own, so it is always exactly one
         row's width and moves with it. -->
    <div
      v-if="dropEdge"
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-primary"
      :class="dropEdge === 'before' ? '-top-px' : '-bottom-px'"
    />

    <!-- Mounted only while open: one dialog per row would otherwise sit behind
         every row of the day. -->
    <FoodEditModal
      v-if="editing && food"
      v-model:open="editing"
      :food="food"
      @saved="store.adoptFood($event)"
    />
  </div>
</template>
