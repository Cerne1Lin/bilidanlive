export function formatTime(ts: number): string {
    const date = new Date(ts * 1000)
    const now = new Date()
    const hhmm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (targetDay.getTime() === today.getTime()) return `今天 ${hhmm}`
    if (targetDay.getTime() === yesterday.getTime()) return `昨天 ${hhmm}`
    if (date.getFullYear() === now.getFullYear()) {
        const mmdd = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/','-')
        return `${mmdd} ${hhmm}`
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${hhmm}`
}