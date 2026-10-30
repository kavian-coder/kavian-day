<script setup lang="ts">
/** 操作说明：一组按键 + 说明。放在设置面板里。 */
defineProps<{ label: string; items: { keys: string[]; text: string }[] }>()
</script>

<template>
  <div class="kw-keys" :aria-label="label">
    <div v-for="item in items" :key="item.text" class="kw-keys__item">
      <span class="kw-keys__keys">
        <span v-for="k in item.keys" :key="k" class="kw-key" :class="{ 'kw-key--wide': k.length > 1 }">{{ k }}</span>
      </span>
      <span class="kw-keys__text">{{ item.text }}</span>
    </div>
  </div>
</template>
