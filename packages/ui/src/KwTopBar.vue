<script setup lang="ts">
/**
 * 全站顶栏：左边是 logo（正式 logo 还没设计，先用一个占位图形），右边是导航。
 * 导航通过插槽传入，方便页面用 NuxtLink。
 */
defineProps<{ name: string; label: string }>()
</script>

<template>
  <nav class="kw-topbar kw-glass" :aria-label="label">
    <slot name="logo">
      <span class="kw-logo" :title="name" :aria-label="name">
        <KwLogo />
      </span>
    </slot>
    <div class="kw-nav"><slot name="nav" /></div>
    <slot name="actions" />
  </nav>
</template>
