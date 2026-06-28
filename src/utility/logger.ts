import { invoke } from "@tauri-apps/api/core";
import {
  error as logError,
  warn as logWarn,
  info as logInfo,
  debug as logDebug,
  trace as logTrace,
} from "@tauri-apps/plugin-log";
import { ref } from "vue";

/** 错误级别日志（始终记录） */
export function error(message: string): Promise<void> {
  return logError(message);
}

/** 警告级别日志 */
export function warn(message: string): Promise<void> {
  return logWarn(message);
}

/** 信息级别日志 */
export function info(message: string): Promise<void> {
  return logInfo(message);
}

/** 调试级别日志（仅在 log_level <= debug 时可见） */
export function debug(message: string): Promise<void> {
  return logDebug(message);
}

/** 跟踪级别日志（仅在 log_level <= trace 时可见） */
export function trace(message: string): Promise<void> {
  return logTrace(message);
}

export const logSize = ref<number>(0)

export function getLogSize() {
  invoke<number>('get_log_file_size').then((val: number) => {
    logSize.value = val
  }).catch((err) => {
    logError(String(err))
  })
}

export function cleanLog() {
  invoke('clean_log_files').catch((err) => {
    logError(String(err))
  })
}
