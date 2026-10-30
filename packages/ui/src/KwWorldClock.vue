<script setup lang="ts">
/**
 * 世界时钟的两部分：
 * - KwWorldClock（默认）：胶囊里的时段 · 季节 · 天气 · 时间，点了展开预览面板
 * - 预览面板在 KwEnvPanel 里
 */
interface Option { id: string; label: string }
const props = defineProps<{
  phase: Option
  season: Option
  weather: Option
  temperature: number | null
  time: string
  phaseIcon: string
  previewing: boolean
  open: boolean
  label: string
}>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <button class="kw-clock" type="button" :aria-expanded="open" :aria-label="props.label" @click="$emit('toggle')">
    <KwIcon :name="phaseIcon" :size="18" class="kw-clock__icon" />
    <span class="kw-clock__phase">{{ phase.label }}</span>
    <span class="kw-clock__sep" aria-hidden="true"></span>
    <span class="kw-clock__item">{{ season.label }}</span>
    <span class="kw-clock__item"><KwIcon :name="weather.id" :size="16" />{{ weather.label }}<span v-if="temperature !== null" class="kw-meta">{{ Math.round(temperature) }}°</span></span>
    <span class="kw-meta kw-clock__time">{{ time }}</span>
    <span v-if="previewing" class="kw-clock__preview" aria-hidden="true"></span>
  </button>
</template>
