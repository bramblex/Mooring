# Service Worker 与 Side Panel 通信模型

这个扩展的核心逻辑应该分成两层：

- `service-worker.ts`：负责浏览器事件、主窗口生命周期、workspace 状态同步和持久化。
- `side panel`：负责 UI 展示和用户操作入口。

Side panel 只有在用户打开侧边栏页面后才运行；service worker 虽然不是常驻进程，但可以被 Chrome 扩展事件唤醒。

## Service Worker 能做什么

MV3 background service worker 可以监听 Chrome 扩展事件，并在事件触发时执行代码。

常用事件：

```ts
chrome.windows.onCreated.addListener(handleWindowCreated);
chrome.windows.onRemoved.addListener(handleWindowRemoved);

chrome.tabs.onCreated.addListener(handleTabCreated);
chrome.tabs.onUpdated.addListener(handleTabUpdated);
chrome.tabs.onMoved.addListener(handleTabMoved);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.tabs.onActivated.addListener(handleTabActivated);

chrome.tabGroups.onCreated.addListener(handleGroupCreated);
chrome.tabGroups.onUpdated.addListener(handleGroupUpdated);
chrome.tabGroups.onMoved.addListener(handleGroupMoved);
chrome.tabGroups.onRemoved.addListener(handleGroupRemoved);
```

这些事件可以用于：

- 判断主窗口是否仍然存在。
- 记录新建窗口是否是临时窗口。
- 在主窗口内持续 snapshot workspace 状态。
- 新 tab 创建时决定是否加入 active workspace。
- 主窗口关闭后标记 `primaryWindowId` 失效。
- 从临时窗口发送 tab 到主窗口。

## Service Worker 中创建或更新 Tab

Service worker 可以在 `windows.onCreated` 或其他事件里创建 tab：

```ts
chrome.windows.onCreated.addListener(async (window) => {
  if (!window.id) return;

  await chrome.tabs.create({
    windowId: window.id,
    url: "https://example.com",
    active: true,
  });
});
```

但新窗口通常已经自带一个默认标签页。如果目标是替换默认页，更稳的是查询窗口里的第一个 tab 并更新它：

```ts
chrome.windows.onCreated.addListener(async (window) => {
  if (!window.id) return;

  const tabs = await chrome.tabs.query({ windowId: window.id });
  const firstTab = tabs[0];

  if (firstTab?.id) {
    await chrome.tabs.update(firstTab.id, {
      url: "https://example.com",
      active: true,
    });
  }
});
```

注意：`windows.onCreated` 触发时，窗口内 tab 可能还没完全 ready。实际实现中可以结合 `tabs.onCreated` 或 `tabs.onUpdated` 兜底。

## 通信方式

Service worker 和 side panel 可以通过三种方式协作。

### 一次性消息

适合 side panel 请求 service worker 执行一个动作。

Side panel：

```ts
const response = await chrome.runtime.sendMessage({
  type: "OPEN_MAIN_WINDOW",
});
```

Service worker：

```ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPEN_MAIN_WINDOW") {
    chrome.windows.create({ focused: true }).then((window) => {
      sendResponse({ ok: true, windowId: window.id });
    });

    return true;
  }
});
```

异步调用 `sendResponse` 时必须 `return true`，否则响应通道可能提前关闭。

### 长连接 Port

适合 side panel 打开期间保持实时通信，例如 service worker 主动推送状态变化。

Side panel：

```ts
const port = chrome.runtime.connect({ name: "sidepanel" });

port.onMessage.addListener((message) => {
  console.log("from service worker", message);
});

port.postMessage({ type: "SIDE_PANEL_READY" });
```

Service worker：

```ts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;

  port.onMessage.addListener((message) => {
    if (message.type === "SIDE_PANEL_READY") {
      port.postMessage({ type: "STATE_UPDATED" });
    }
  });
});
```

第一版不需要急着用 Port。只有当 storage 监听无法满足实时性时再引入。

### chrome.storage 共享状态

适合作为 workspace 的持久化 source of truth。

Service worker 写入：

```ts
await chrome.storage.local.set({ workspaceState });
```

Side panel 读取：

```ts
const { workspaceState } = await chrome.storage.local.get("workspaceState");
```

Side panel 监听变化：

```ts
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.workspaceState) {
    renderWorkspaceState(changes.workspaceState.newValue);
  }
});
```

推荐第一版使用：

- `chrome.storage.local` 保存状态。
- `chrome.storage.onChanged` 通知 side panel 刷新 UI。
- `chrome.runtime.sendMessage` 处理用户动作。

## 推荐分工

### Service Worker

Service worker 应该拥有 Workspace / Page / Unmanaged 状态的写入权。`service-worker.ts` 只保留入口，具体业务由 `AppModel` 协调领域模型完成。

职责：

- 初始化 `primaryWindowId`。
- 判断当前窗口是否是主窗口。
- 监听 window/tab/group 事件。
- 主窗口变化后 snapshot workspace。
- 主窗口关闭后进入 `main window missing` 状态。
- 处理 `Open main window`。
- 处理 `Send current tab to main window`。
- 处理 `Send all tabs to main window`。
- 处理固定 tab 的打开、关闭和恢复。
- 调用 `WorkspaceModel` 处理 Workspace 容器。
- 调用 `WorkspacePageModel` 处理 Workspace 内 Page。
- 调用 `UnmanagedModel` 处理未管理 Chrome Tab / Chrome Group。
- 通过 `WorkspaceRuntimeStore` 管理 `chrome.storage.session` runtime binding。

### Side Panel

Side panel 不应该直接维护长期状态。它是 UI 和用户操作入口。

职责：

- 读取 `workspaceState`。
- 根据当前窗口渲染主窗口 UI 或临时窗口 UI。
- 监听 `chrome.storage.onChanged` 并刷新。
- 用户点击按钮时发送 message 给 service worker。
- 展示 service worker 返回的结果或错误。

### 共享状态

`WorkspaceState` 是 side panel 的渲染快照，不是长期可信状态。

```ts
type WorkspaceState = {
  workspaces: Workspace[];
  unmanagedPages: Page[];
  unmanagedGroups: UnmanagedGroup[];
};
```

长期可信状态来自 Bookmark；`tabId`、`groupId`、`windowId` 都是运行时绑定，不能作为长期可信 ID。

## 消息协议

第一版可以定义这些 message type：

```ts
type RuntimeMessage =
  | { type: "GET_WORKSPACE_STATE" }
  | { type: "OPEN_MAIN_WINDOW" }
  | { type: "SEND_CURRENT_TAB_TO_MAIN_WINDOW" }
  | { type: "SEND_ALL_TABS_TO_MAIN_WINDOW" }
  | { type: "CREATE_WORKSPACE"; name?: string }
  | { type: "RENAME_WORKSPACE"; workspaceId: string; name: string }
  | { type: "UPDATE_WORKSPACE_COLOR"; workspaceId: string; color: chrome.tabGroups.TabGroup["color"] }
  | { type: "TOGGLE_WORKSPACE_COLLAPSED"; workspaceId: string }
  | { type: "OPEN_PINNED_WORKSPACE_TAB"; workspaceId: string; workspaceTabId: string }
  | { type: "PIN_TAB"; tabId: number }
  | { type: "UNPIN_WORKSPACE_TAB"; workspaceId: string; workspaceTabId: string };
```

统一响应格式：

```ts
type RuntimeResponse<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
```

Side panel 只根据响应更新临时 UI 状态，长期状态以 `chrome.storage.local` 为准。

## 主窗口打开与关闭

Service worker 需要监听窗口关闭：

```ts
chrome.windows.onRemoved.addListener(async (windowId) => {
  const state = await getWorkspaceState();

  if (state.primaryWindowId !== windowId) return;

  await saveWorkspaceState({
    ...state,
    primaryWindowId: undefined,
  });
});
```

当 side panel 发送 `OPEN_MAIN_WINDOW`：

1. 如果 `primaryWindowId` 仍然有效，聚焦主窗口。
2. 如果主窗口缺失，创建新窗口。
3. 保存新的 `primaryWindowId`。
4. 从 `WorkspaceState.workspaces` 恢复 workspace。

## 设计原则

- Service worker 是状态写入和浏览器事件协调者。
- Side panel 是 UI，不是长期状态源。
- `chrome.storage.local` 是 source of truth。
- 第一版用 `sendMessage + storage.onChanged` 足够。
- Port 通信等到需要实时推送时再加。
- 不依赖 service worker 常驻；所有事件处理都要能从 storage 恢复上下文。
