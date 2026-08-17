<script setup lang="ts">
import type { MatchRange } from '~/utils/search'

const props = defineProps<{
  text: string
  /** Where the search landed, in offsets into `text`. Empty is plain text. */
  ranges?: MatchRange[]
}>()

const parts = computed(() => splitParts(props.text, props.ranges ?? []))
</script>

<template>
  <!-- No whitespace between the runs: they are one word cut into pieces, and a
       newline in the template becomes a space in the middle of it. -->
  <span
    ><template v-for="(part, index) in parts" :key="index"
      ><mark
        v-if="part.match"
        class="rounded-[3px] bg-primary/20 font-medium text-highlighted"
        >{{ part.text }}</mark
      ><template v-else>{{ part.text }}</template></template
  ></span>
</template>
