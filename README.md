# Mooring

Mooring is a lightweight Chrome side panel workspace manager. It connects Chrome concepts users already understand: tabs, tab groups, bookmarks, and the side panel.

Mooring 是一个轻量的 Chrome 侧边栏 Workspace 工具。它不重新发明一套标签页管理系统，而是把用户已经熟悉的 Chrome 标签页、标签组、书签和侧边栏连接起来。

## Core Ideas / 核心理念

- **Native Chrome workflow / 原生 Chrome 工作流**: Mooring stays in the side panel and works with the current Chrome window instead of replacing the browser with a separate dashboard.
- **Workspace as bookmark folder / Workspace 是书签文件夹**: each workspace is stored as a Chrome bookmark folder under `Mooring Workspace`.
- **Pinned Page as bookmark / 固定 Page 是书签**: pages you want to keep are saved as bookmarks and can be restored even after their Chrome Tab is closed.
- **Temp Page as live tab / 临时 Page 是当前打开的 Chrome Tab**: unstarred pages are temporary and disappear when their Chrome Tabs are closed.
- **Chrome Group as projection / Chrome 标签组是运行时投影**: Chrome tab groups show the open state of workspaces, but bookmarks remain the source of truth.
- **Main window model / 主窗口模型**: one primary Chrome window owns workspace behavior; temporary windows can send tabs back to it.
- **No cloud backend / 没有云端后端**: long-lived data is bookmark-backed, while runtime bindings use `chrome.storage.session`.

## Product Positioning / 产品定位

Mooring is not an AI tab organizer or a kanban board for archived tabs. It is a small, local-first workspace layer for people who already like Chrome's tab groups but want stable workspace structure, pinned pages that survive tab closure, and quick recovery through the Chrome side panel.

Mooring 不是 AI 标签页整理器，也不是把标签页变成看板的归档工具。它更像一个小而稳定的 Chrome Workspace 层：重要页面固定，临时页面随用随走，关闭的固定页面可以随时恢复。

The product goal is low cognitive load. In daily use, the model is intentionally small:

产品目标是低心智负担。日常使用里只有一个很小的循环：

- workspaces hold related pages / Workspace 放相关页面；
- starred pages stay saved / 星标页面会保存；
- unstarred pages stay temporary / 未星标页面保持临时；
- closed pinned pages can be restored later / 关闭的固定页面之后仍可恢复。

That loop is meant to solve most everyday workspace problems without turning tab management into another project to maintain.

这套循环希望解决大多数日常 Workspace 问题，同时不把“管理标签页”变成另一件需要维护的事。

There is also no migration trap. If someone stops using Mooring, their saved pages are still ordinary Chrome bookmarks. Workspaces remain inspectable and movable in Chrome's bookmark manager, so leaving the extension does not mean exporting or recovering data from a proprietary store.

它也没有迁移陷阱。即使停止使用 Mooring，保存下来的页面仍然是普通 Chrome 书签；Workspace 仍然可以在 Chrome 书签管理器里查看、移动和整理。

## Tech Stack / 技术栈

- Vue 3
- Vite
- TypeScript
- Chrome Extension Manifest V3
- Chrome Side Panel API
- Chrome Tabs, Tab Groups, Bookmarks, and Storage APIs

The Vue template is compiled during `npm run build`, so the extension runtime does not need `unsafe-eval`.

Vue 模板会在 `npm run build` 时编译，扩展运行时不需要 `unsafe-eval`。

## Scripts / 脚本

```sh
npm install
npm run build
```

## Load Locally / 本地加载

1. Run `npm run build` / 运行 `npm run build`。
2. Open `chrome://extensions` / 打开 `chrome://extensions`。
3. Enable **Developer mode** / 开启 **Developer mode**。
4. Click **Load unpacked** / 点击 **Load unpacked**。
5. Select `/Users/brambles/Workspace/chrome-workspace/dist` / 选择 `/Users/brambles/Workspace/chrome-workspace/dist`。
6. Click the extension icon or press `Command+Shift+Y` to open the side panel / 点击扩展图标或按 `Command+Shift+Y` 打开侧边栏。

## Docs / 文档

- [Product Logic / 产品逻辑](docs/product-logic.md)
- [Window Model / Window 模型](docs/window-model.md)
- [Workspace Model / Workspace 模型](docs/workspace-model.md)
- [Page Model / Page 模型](docs/page-model.md)
- [Service Worker 与 Side Panel 通信模型](docs/service-sidepanel-communication.md)
