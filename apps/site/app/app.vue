<script setup lang="ts">
const { light } = useEnvironment()
const head = useLocaleHead()
useHead(() => ({
  htmlAttrs: { 'data-light': light.value, lang: head.value.htmlAttrs?.lang },
  link: head.value.link,
  meta: head.value.meta,
  titleTemplate: (t?: string) => (t ? `${t} · Kavian` : 'Kavian'),
}))
</script>

<template>
  <NuxtPage />
</template>
