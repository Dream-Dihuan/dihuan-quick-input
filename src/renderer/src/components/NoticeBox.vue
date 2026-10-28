<script setup lang="ts">
/**
 * Card-level notice: one summary line stays visible, the details expand on
 * demand. Native <details> gives keyboard and screen-reader behavior for free.
 */
const props = withDefaults(
  defineProps<{
    title: string
    items?: string[]
    tone?: 'warning' | 'danger'
    defaultOpen?: boolean
  }>(),
  { items: () => [], tone: 'warning', defaultOpen: false }
)
</script>

<template>
  <details class="notice" :class="`notice--${props.tone}`" :open="props.defaultOpen">
    <summary class="notice-summary">
      <span class="notice-title">{{ props.title }}</span>
      <span v-if="props.items.length > 0" class="notice-count">{{ props.items.length }} 条</span>
    </summary>
    <div class="notice-body">
      <p v-for="item in props.items" :key="item">{{ item }}</p>
      <slot></slot>
    </div>
  </details>
</template>
