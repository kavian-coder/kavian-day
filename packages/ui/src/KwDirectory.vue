<script setup lang="ts">
/** 快捷目录：不经过世界直接找内容。 */
defineProps<{ title: string; closeLabel: string; items: { name: string; hint: string; count: string; href: string }[] }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <nav class="kw-dir kw-glass" :aria-label="title">
    <div class="kw-panel__head">
      <span class="kw-label">{{ title }}</span>
      <button class="kw-panel__close" type="button" :aria-label="closeLabel" @click="$emit('close')"><KwIcon name="close" :size="16" /></button>
    </div>
    <ol>
      <li v-for="item in items" :key="item.name">
        <a :href="item.href">
          <span class="kw-dir__name">{{ item.name }}</span>
          <span class="kw-dir__hint">{{ item.hint }}</span>
          <span class="kw-meta kw-dir__count">{{ item.count }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>
