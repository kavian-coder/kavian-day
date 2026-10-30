<script setup lang="ts">
/** 圆形图标按钮。label 同时是无障碍名称和悬停提示；badge 是叠在右下角的小字（比如语言）。 */
defineProps<{ icon: string; label: string; pressed?: boolean; badge?: string }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button class="kw-iconbtn" type="button" :aria-label="label" :aria-pressed="pressed" :data-tip="label" @click="$emit('click')">
    <KwIcon :name="icon" />
    <span v-if="badge" class="kw-iconbtn__badge">{{ badge }}</span>
  </button>
</template>
