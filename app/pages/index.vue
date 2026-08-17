<script setup lang="ts">
// "Today" is whatever today is where the user is standing, so the redirect
// happens on the client where the timezone is actually known.
onMounted(() => {
  void navigateTo(`/log/${todayIso()}`, { replace: true })
})
</script>

<template>
  <div class="grid min-h-dvh place-items-center">
    <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
  </div>
</template>
