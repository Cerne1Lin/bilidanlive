import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index.ts";
import { loadingDirective } from "./directives/loading";
import { setupAutoSave, initSettings } from "./detail/Setting";
import { error as logError } from "./utility/logger";

// 注册 ref 变化 → Rust 自动持久化
setupAutoSave();
// 启动时从 Rust 加载设置到 ref（完成前 watcher 不会触发）
initSettings();

const app = createApp(App);
app.config.errorHandler = (err) => {
    logError(`[Vue] 全局错误: ${String(err)}`);
    console.error(err);
}
app.directive("loading", loadingDirective);
app.use(router)
app.mount("#app");
