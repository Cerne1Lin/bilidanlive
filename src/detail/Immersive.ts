import { ref } from "vue"

const isImmersive = ref(false)
const summary = ref('')
function toggleImmersive(s: string) {
    if (isImmersive.value) {
        isImmersive.value = false
        summary.value = ''
    } else {
        isImmersive.value = true
        summary.value = s
    }
}

export default {
    isImmersive,
    summary,
    toggleImmersive,
}