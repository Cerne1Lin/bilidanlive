<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import TitleBar from './components/TitleBar.vue';
import { svg } from './detail/Assets'
import Tip from './components/Tip.vue'
import { tipList } from './utility/tip.ts';
import { hlColor, accentColor, bgLightColor, docBgColor, enableGlobalBlur } from './detail/Theme.ts';

const router = useRouter()

// html/body 是 Vue 根元素祖先，v-bind() in CSS 无法向上传递，改用 JS 同步
watchEffect(() => {
  document.body.style.backgroundColor = docBgColor.value
})
watchEffect(() => {
  const root = document.documentElement
  if (enableGlobalBlur.value) {
    root.style.setProperty('backdrop-filter', 'blur(10px)')
    root.style.setProperty('-webkit-backdrop-filter', 'blur(10px)')
  } else {
    root.style.removeProperty('backdrop-filter')
    root.style.removeProperty('-webkit-backdrop-filter')
  }
})

const transitionName = ref('slide-right')

router.beforeEach((to, from) => {
  const toIdx = (to.meta.index as number) ?? 0
  const fromIdx = (from.meta.index as number) ?? 0
  transitionName.value = toIdx > fromIdx ? 'slide-left' : 'slide-right'
})

const navItems = ref([
  {
    svg: svg.homeSvg,
    text: '直播间',
    to: '/'
  },
  {
    svg: svg.personalSvg,
    text: '个人',
    to: '/personal'
  },
  {
    svg: svg.settingSvg,
    text: '设置',
    to: '/setting'
  }
])
</script>

<template>
  <TitleBar 
    :bg-color="bgLightColor" 
    :nav-items="navItems" 
    :active-color="bgLightColor"
    :icon-color="hlColor"
    :active-icon-color="accentColor"
  />
  <div class="router-content">
    <Tip v-if="tipList.length !== 0" class="tip-container" :items="tipList"/>
    <router-view v-slot="{ Component, route }">
      <Transition :name="transitionName" mode="out-in">
        <KeepAlive>
          <component :is="Component" :key="route.path" />
        </KeepAlive>
      </Transition>
    </router-view>
  </div>
</template>

<style>
html, body {
  font-size: 16px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border-radius: 16px;
}
.tip-container {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 200;
}

/* ── slide-left：进入 view 的 index 更大，内容向左移动 ── */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* ── slide-right：进入 view 的 index 更小，内容向右移动 ── */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.slide-right-leave-active {
  position: absolute;
}
.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.titlebar {
  height: 2em;
  background-color: transparent;
  user-select: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
}

/* Push page content below the fixed titlebar */
.router-content {
  position: fixed;
  top: 2em;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
}
</style>