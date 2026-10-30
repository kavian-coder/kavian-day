<script setup lang="ts">
/** 时段 / 季节 / 天气预览面板。不在预览时显示“实时”，在预览时显示“回到现在”。 */
interface Option { id: string; label: string }
defineProps<{
  phase: string
  season: string
  weather: string
  phases: Option[]
  seasons: Option[]
  weathers: Option[]
  previewing: boolean
  labels: { previewTitle: string; season: string; weather: string; reset: string; live: string; liveHint: string; source: string }
}>()
const emit = defineEmits<{ preview: [kind: 'phase' | 'season' | 'weather', id: string]; reset: [] }>()
</script>

<template>
  <div class="kw-envpanel kw-glass" role="dialog" :aria-label="labels.previewTitle">
    <span class="kw-label">{{ labels.previewTitle }}</span>
    <div class="kw-chips kw-chips--phases">
      <button v-for="p in phases" :key="p.id" type="button" :aria-pressed="p.id === phase" @click="emit('preview', 'phase', p.id)">{{ p.label }}</button>
    </div>
    <div class="kw-envpanel__row">
      <div>
        <span class="kw-label">{{ labels.season }}</span>
        <div class="kw-chips">
          <button v-for="s in seasons" :key="s.id" type="button" :aria-pressed="s.id === season" @click="emit('preview', 'season', s.id)">{{ s.label }}</button>
        </div>
      </div>
    </div>
    <span class="kw-label">{{ labels.weather }}</span>
    <div class="kw-chips">
      <button v-for="w in weathers" :key="w.id" type="button" :aria-pressed="w.id === weather" @click="emit('preview', 'weather', w.id)">
        <KwIcon :name="w.id" :size="15" />{{ w.label }}
      </button>
    </div>
    <div class="kw-envpanel__foot">
      <Transition name="kw-fade" mode="out-in">
        <button v-if="previewing" key="reset" class="kw-btn kw-btn--glow" type="button" @click="emit('reset')">{{ labels.reset }}</button>
        <span v-else key="live" class="kw-live"><span class="kw-live__dot"></span>{{ labels.live }}<span class="kw-meta">{{ labels.liveHint }}</span></span>
      </Transition>
      <span class="kw-meta kw-envpanel__src">{{ labels.source }}</span>
    </div>
  </div>
</template>
