<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
useHead({ title: () => t('about.title') })
</script>

<template>
  <main class="page">
    <header class="kw-article">
      <span class="kw-label">ABOUT · {{ t('places.home.name') }}</span>
      <h1 class="kw-article__title">{{ t('about.title') }}</h1>
      <p class="kw-article__lede">{{ t('about.lede') }}</p>
    </header>
    <div class="kw-empty" style="margin-top: var(--space-12)">
      <p style="margin: 0">{{ t('about.body') }}</p>
      <NuxtLink class="kw-link" :to="localePath('/')">{{ t('about.back') }}</NuxtLink>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 760px;
  margin: 0 auto;
  padding-block: var(--space-16);
  padding-left: max(var(--space-4), env(safe-area-inset-left, 0px));
  padding-right: max(var(--space-4), env(safe-area-inset-right, 0px));
}
</style>
