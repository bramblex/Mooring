# Agents

## 项目定位

这是一个 Vue 3 + Vite + TypeScript 的 Chrome MV3 侧边栏扩展，用 Chrome 标签组承载轻量 workspace 体验。

## 开发约定

- 修改前先读现有结构，优先沿用当前代码风格。
- `service-worker.ts` 不直接堆业务逻辑，入口放在 `AppModel`。
- `src/models` 放领域模型。
- `src/sidepanel` 放 UI 和交互层。
- 不引入运行时 Vue template compiler，模板通过 Vite 构建。
- 构建产物在 `dist/`，本地加载扩展时选择 `dist`。

## UI 风格约定

- 侧边栏空间紧张，新增操作入口优先保持轻量，不要把低频按钮塞进 Workspace header。
- 按钮样式优先沿用现有全局 `button` / `.icon-button` 规则：32px 左右、6px 圆角、普通边框、普通背景、hover 时使用现有边框和背景变化。
- 如果需要多个悬浮操作按钮，外层容器只负责定位和排列，不额外做卡片、玻璃拟态、重阴影、特殊背景或主次按钮外观。
- 右下角悬浮操作区使用两个独立按钮的视觉，按钮之间用简单间距区分；不要做成独立 toolbar/card 风格。
- 新增 icon-only 按钮必须有 `title` 和 `aria-label`，并保持中英文 i18n 文案同步。

## Model 边界

- `AppModel` 是 service worker 侧的应用入口，负责注册 Chrome 事件和接收 side panel 消息。
- `WindowModel` 表示单个窗口实体，只保存窗口 ID、窗口角色和窗口下的工作区列表。
- `WorkspaceModel` 后续承载 workspace 数据。
- `TabModel` 后续承载 workspace 内 tab 数据。
- Workspace 静态结构使用 Chrome 书签树，运行时窗口和 tab 绑定保存在内存。

## Window 规则

- 主窗口 ID 只存在内存中，不写入 `chrome.storage.local`。
- 扩展刚安装或启动初始化时，如果没有主窗口，当前窗口成为主窗口。
- 初始化完成后，如果没有主窗口，下一个新打开的窗口成为主窗口。
- 已经存在的窗口不会因为主窗口缺失而自动变成主窗口。
- 有主窗口时，新打开窗口都是临时窗口。
- 临时窗口没有 workspace 功能。
- 临时窗口 side panel 只提供：
  - `Open main window`
  - `Send current tab to main window`
  - `Send all tabs to main window`

## Service Worker 与 Side Panel

- 主窗口状态在 service worker 的 `AppModel` 内存里。
- Side panel 不直接维护主窗口状态。
- Side panel 通过 `chrome.runtime.sendMessage` 请求：
  - `GET_WINDOW_CONTEXT`
  - `OPEN_MAIN_WINDOW`
  - `SEND_CURRENT_TAB_TO_MAIN_WINDOW`
  - `SEND_ALL_TABS_TO_MAIN_WINDOW`

## Workspace 存储

- 使用 `chrome.bookmarks` 管理 workspace 静态结构。
- 根目录为 `Mooring Workspace`。
- 每个 workspace 是根目录下的书签文件夹。
- Workspace 文件夹 title 格式为 `[color] name`，例如 `[blue] Work`。
- 每个固定 tab 是 workspace 文件夹里的 bookmark。
- Workspace 顺序和固定 tab 顺序使用书签顺序。
- 运行时状态，例如 `groupId`、`openTabId`、主窗口 ID，不写入书签。

## 验证

提交或交付前运行：

```sh
npm run build
```

如果只改文档，可以说明未运行构建。
