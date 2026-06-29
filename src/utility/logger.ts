import { invoke } from "@tauri-apps/api/core";
import {
    error as logError,
    warn as logWarn,
    info as logInfo,
    debug as logDebug,
    trace as logTrace,
} from "@tauri-apps/plugin-log";
import { ref } from "vue";

export {
    logError as error,
    logWarn as warn,
    logInfo as info,
    logDebug as debug,
    logTrace as trace,
};

export const logSize = ref<number>(0);

export function getLogSize() {
    invoke<number>("get_log_file_size")
        .then((val: number) => {
            logSize.value = val;
        })
        .catch((err) => {
            logError(String(err));
        });
}

export function cleanLog() {
    invoke("clean_log_files").catch((err) => {
        logError(String(err));
    });
}
