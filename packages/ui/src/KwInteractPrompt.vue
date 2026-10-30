<script setup lang="ts">
/** 角色靠近门或物件时浮在上方的提示。可以按 E，也可以直接点。x、y 是物体在屏幕上的位置。 */
defineProps<{ keyName: string; action: string; target?: string; locked?: boolean; x: number; y: number }>()
defineEmits<{ activate: [] }>()
</script>

<template>
  <button
    class="kw-prompt kw-glass"
    :class="{ 'kw-prompt--locked': locked }"
    type="button"
    :disabled="locked"
    :style="{ position: 'absolute', left: `${x}px`, top: `${y}px` }"
    @click="$emit('activate')"
  >
    <span class="kw-key">{{ keyName }}</span>
    <span>{{ action }}<template v-if="target"> <b>{{ target }}</b></template></span>
  </button>
</template>
