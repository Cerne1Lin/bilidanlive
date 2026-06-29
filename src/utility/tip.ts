import { ref } from "vue";

export type TipLevel = "success" | "info" | "warning" | "error";

export const TipLevelConst = {
    SUCCESS: "success",
    INFO: "info",
    WARNING: "warning",
    ERROR: "error",
} as const satisfies Record<string, TipLevel>;

interface TipItem {
    level: TipLevel;
    message: string;
    key: number;
    canClose: boolean;
}

const tipList = ref<TipItem[]>([]);
let currentId = 0;
function getId(): number {
    return currentId++;
}

function addTip(message: string, level: TipLevel, sec: number = 3) {
    const key = getId();
    let canClose = false;
    if (sec === -1) canClose = true;
    const item: TipItem = { level, message, key, canClose };
    tipList.value.push(item);
    if (sec !== -1) {
        setTimeout(() => {
            removeTip(key);
        }, sec * 1000);
    }
}

function removeTip(key: number) {
    const idx = tipList.value.findIndex((it) => it.key === key);
    if (idx !== -1) tipList.value.splice(idx, 1);
}

export type { TipItem };
export { tipList, addTip, removeTip };
