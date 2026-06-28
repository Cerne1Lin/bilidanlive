import type { Directive } from 'vue'
import { computed } from 'vue'
import { darkTheme, glassmorphismBackground } from '../detail/Theme'

const MASK_CLASS = 'v-loading-mask'
const SPINNER_CLASS = 'v-loading-spinner'
let styleInjected = false
const spinnerColor = computed(() => {
    if (darkTheme.value || glassmorphismBackground.value) {
        return 'white'
    } else {
        return 'black'
    }
})
const maskColor = computed(() => {
    if (darkTheme.value || glassmorphismBackground.value) {
        return '#46464688'
    } else {
        return '#aeaeae8e'
    }
})

function injectStyles() {
    if (styleInjected) return
    styleInjected = true
    const style = document.createElement('style')
    style.textContent = `
        @keyframes v-loading-spin {
            to { transform: rotate(360deg); }
        }
        .${SPINNER_CLASS} {
            width: 32px;
            height: 32px;
            border: 3px solid rgba(255, 255, 255, 0.2);
            border-top-color: ${spinnerColor.value};
            border-radius: 50%;
            animation: v-loading-spin 0.8s linear infinite;
        }
    `
    document.head.appendChild(style)
}

function createMask(): HTMLElement {
    injectStyles()
    const mask = document.createElement('div')
    mask.className = MASK_CLASS
    mask.style.cssText = `
        position: absolute;
        inset: 0;
        background: ${maskColor.value};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999;
        pointer-events: auto;
    `
    const spinner = document.createElement('div')
    spinner.className = SPINNER_CLASS
    mask.appendChild(spinner)
    return mask
}

function ensurePosition(el: HTMLElement) {
    const pos = getComputedStyle(el).position
    if (pos === 'static') {
        el.style.position = 'relative'
    }
}

export const loadingDirective: Directive<HTMLElement, boolean> = {
    mounted(el, binding) {
        if (binding.value) {
            ensurePosition(el)
            el.appendChild(createMask())
        }
    },
    updated(el, binding) {
        const mask = el.querySelector(`.${MASK_CLASS}`) as HTMLElement | null
        if (binding.value && !mask) {
            ensurePosition(el)
            el.appendChild(createMask())
        } else if (!binding.value && mask) {
            mask.remove()
        }
    },
    unmounted(el) {
        const mask = el.querySelector(`.${MASK_CLASS}`) as HTMLElement | null
        mask?.remove()
    },
}
