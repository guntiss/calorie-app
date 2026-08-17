<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <div class="grid min-h-dvh place-items-center px-6">
    <div class="w-full max-w-xs text-center">
      <UIcon name="i-lucide-flame" class="size-10 text-primary" />
      <h1 class="mt-3 text-2xl font-semibold">
        Calorie
      </h1>
      <p class="mt-1 text-sm text-muted">
        Your foods, your log, no guesswork.
      </p>

      <UAlert
        v-if="route.query.error"
        class="mt-4 text-left"
        color="error"
        variant="subtle"
        title="Sign-in failed"
        description="Something went wrong with Google sign-in. Please try again."
      />

      <UButton
        to="/auth/google"
        external
        block
        size="lg"
        class="mt-6"
        icon="i-lucide-log-in"
        label="Continue with Google"
      />
    </div>
  </div>
</template>
