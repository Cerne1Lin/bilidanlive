<template>
  <div
    class="toggle-switch"
    :class="{ 'is-active': value, 'is-disabled': disabled }"
    :style="cssVars"
    @click="toggle"
  >
    <span class="toggle-knob"></span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  disabled?: boolean
  /** 激活态背景色 */
  activeColor?: string
  /** 关闭态背景色 */
  inactiveColor?: string
}>(), {
  disabled: false,
  activeColor: 'pink',
  inactiveColor: '#c0c0c0',
})

const value = defineModel<boolean>('value',{ required: true })

const cssVars = computed(() => ({
  '--tw-active-color': props.activeColor,
  '--tw-inactive-color': props.inactiveColor,
}))

function toggle() {
  if (props.disabled) return
  value.value = !(value.value)
}
</script>

<style scoped>
.toggle-switch {
  position: relative;
  width: 3em;
  height: 1.5em;
  border-radius: 99px;
  background: var(--tw-inactive-color);
  cursor: pointer;
  transition: background 0.25s ease;
  user-select: none;
}

.toggle-switch.is-active {
  background: var(--tw-active-color);
}

.toggle-switch.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toggle-knob {
  position: absolute;
  top: 50%;
  left: 0.2em;
  width: 1.1em;
  height: 1.1em;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transform: translateY(-50%);
  transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.toggle-switch.is-active .toggle-knob {
  left: calc(100% - 1.3em);
}
</style>
