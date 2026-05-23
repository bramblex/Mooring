# 窗口、Workspace 与标签页模型

这个扩展把 Chrome 标签组当成轻量版 Arc workspace 来使用，但 workspace 只属于一个“主窗口”。其他 Chrome 窗口都是临时窗口，可以把标签页送回主窗口，但不参与完整 workspace 管理。

## 目标

- 让 workspace 行为可预测。
- 让 workspace 持久化，不依赖 Chrome 会话级 ID。
- 避免一开始就处理复杂的跨窗口同步。
- 允许临时窗口存在，但不污染 workspace 状态。
- 主窗口被关闭后，可以从存储的数据恢复 workspace。

## 核心概念

### 主窗口

主窗口是唯一启用 workspace 管理能力的 Chrome 窗口。

- 没有主窗口时，下一个新打开的窗口成为主窗口。
- 主窗口 ID 存为内存态 `primaryWindowId`，不写入 `chrome.storage.local`。
- 只有主窗口里的侧边栏显示完整 workspace 管理 UI。
- 其他窗口都是临时窗口。
- UI 不提供 `Set as primary`，临时窗口不能直接变成主窗口。
- 已经存在的临时窗口不会因为主窗口缺失而自动变成主窗口。

Chrome 本身没有“主窗口”概念，`primaryWindowId` 是扩展运行时内存里的产品状态。

### 临时窗口

只要当前窗口的 `windowId` 不等于 `primaryWindowId`，它就是临时窗口。

临时窗口侧边栏只显示精简操作：

- `Open main window`
- `Send current tab to main window`
- `Send all tabs to main window`

临时窗口默认不展示完整 workspace 管理能力。

### Workspace

Workspace 是扩展自己的持久化模型。Chrome 标签组只是 workspace 在主窗口里的运行时投影。

长期数据不能依赖 `tabGroupId`，因为 Chrome 的标签组 ID 只在当前浏览器会话里稳定。

```ts
type Workspace = {
  id: string;
  name: string;
  color: chrome.tabGroups.TabGroup["color"];
  tabs: WorkspaceTab[];
  activeUrl?: string;
  collapsed?: boolean;
  order: number;
};

type WorkspaceTab = {
  id: string;
  url: string;
  title?: string;
  pinned: boolean;
  order: number;
  openTabId?: number;
};
```

### 运行时绑定

运行时，一个 workspace 可能绑定到一个 Chrome 标签组和一组标签页。

```ts
type RuntimeWorkspaceBinding = {
  workspaceId: string;
  groupId: number;
  tabIds: number[];
};
```

运行时绑定可以通过扫描主窗口重新建立。

## 存储状态

```ts
type WorkspaceState = {
  activeWorkspaceId?: string;
  workspaces: Workspace[];
};
```

这份 workspace 状态存到 `chrome.storage.local`。主窗口 ID 不存储，只保存在 `WindowModel` 的内存状态里。

`groupId` 和 `tabId` 不能作为长期可信数据保存。它们可以作为运行时缓存，但必须按会话级 ID 对待。

## 主窗口行为

侧边栏打开时：

1. 使用 `chrome.windows.getCurrent()` 获取当前窗口。
2. 读取 `WorkspaceState`。
3. 如果当前 `windowId === primaryWindowId`，渲染完整 workspace UI。
4. 否则渲染临时窗口 UI。

如果没有 `primaryWindowId`，当前已经存在的窗口仍然按临时窗口处理。用户可以通过 `Open main window` 打开新的主窗口。

完整 workspace UI 包括：

- 展示 workspace 列表。
- 创建 workspace。
- 重命名 workspace。
- 修改 workspace 颜色。
- 折叠或展开 workspace。
- 拖动 workspace 排序。
- 在 workspace 之间拖动标签页。
- 把当前激活标签页送入 workspace。
- 固定或取消固定 workspace 内的标签页。
- 从存储的 URL 恢复缺失的 workspace。

## 临时窗口行为

临时窗口不直接管理 workspace 状态。

### Open main window

如果 `primaryWindowId` 存在，并且主窗口还打开着：

```ts
await chrome.windows.update(primaryWindowId, { focused: true });
```

如果主窗口已经不存在：

1. 新建一个 Chrome 窗口。
2. 把新窗口 ID 存为 `primaryWindowId`。
3. 从存储的 workspace 数据恢复主窗口。

### Send current tab to main window

如果主窗口存在：

1. 把当前激活标签页移动到主窗口。
2. 如果存在 active workspace，把标签页加入对应标签组。
3. 聚焦主窗口。

如果主窗口不存在：

1. 先重新打开主窗口。
2. 把当前激活标签页移动进去。
3. 加入 active workspace。

### Send all tabs to main window

逻辑和发送当前标签页一样，但移动临时窗口里的全部标签页。

置顶标签页、特殊页面等边界情况可以后续处理。第一版可以只处理普通标签页。

## 主窗口被关闭

不要自动把某个临时窗口提升为主窗口。

主窗口关闭后：

- 保留 `workspaces` 存储数据。
- 把内存里的 `primaryWindowId` 清空。
- 已存在的其他窗口仍然是临时窗口。
- 临时窗口侧边栏显示 `Main window is closed` 状态。

此时可用操作：

- `Reopen main window`
- `Send current tab to reopened main window`
- `Send all tabs to reopened main window`

这样可以避免用户困惑：某个临时窗口不应该突然变成 workspace 主基地。

## Workspace 持久化

持久化应该持续发生，而不是只等窗口关闭。

只要当前窗口是主窗口，在以下事件后都应该重新 snapshot workspace 状态：

- 标签页创建。
- 标签页更新。
- 标签页移动。
- 标签页关闭。
- 标签页激活。
- 标签组创建。
- 标签组更新。
- 标签组移动。
- 标签组移除。

Snapshot 流程：

1. 用 `chrome.tabs.query({ windowId: primaryWindowId })` 查询主窗口标签页。
2. 用 `chrome.tabGroups.query({ windowId: primaryWindowId })` 查询主窗口标签组。
3. 按 `groupId` 聚合标签页。
4. 对每个 Chrome 标签组，绑定或创建一个 workspace。
5. 存储 `name`、`color`、`collapsed`、`order` 和 workspace 标签页列表。
6. 在可以判断时，存储 active workspace 和 active URL。

未分组标签页第一版可以保持未分组，不必作为 workspace 持久化。

Snapshot 时要区分固定标签页和普通标签页：

- 固定标签页即使当前没有打开的 Chrome tab，也必须保留在 `Workspace.tabs` 里。
- 普通标签页关闭后应该从 `Workspace.tabs` 里移除。
- 如果一个固定标签页当前打开着，用 `openTabId` 记录它的运行时 tab ID。
- `openTabId` 不能作为长期可信数据，只能作为当前会话的运行时绑定。

## 固定标签页

Workspace 内的标签页可以被固定。固定后的标签页属于 workspace 的长期结构，而不只是当前打开的 Chrome tab。

固定标签页的行为：

- 固定标签页关闭页面后，仍然保留在对应 workspace 里。
- 固定标签页再次被点击时，在它原本的位置重新打开对应 URL。
- 重新打开后，要加入对应 workspace 的 Chrome 标签组。
- 固定标签页的顺序保存在 `WorkspaceTab.order`。
- 固定标签页可以拖动排序。
- 固定标签页可以取消固定；取消固定后，如果页面被关闭，就从 workspace 中移除。

普通标签页的行为：

- 普通标签页只代表当前打开的 Chrome tab。
- 普通标签页关闭后，从 workspace 中移除。
- 普通标签页可以被固定，固定后转成 `WorkspaceTab` 的长期数据。

### 点击固定标签页

点击 workspace 里的固定标签页时：

1. 如果 `openTabId` 仍然有效，直接激活该 Chrome tab。
2. 如果 `openTabId` 已失效或不存在，在该 workspace 对应位置创建新标签页。
3. 新标签页 URL 使用 `WorkspaceTab.url`。
4. 新标签页加入该 workspace 对应 Chrome 标签组。
5. 更新 `openTabId` 并 snapshot。

伪代码：

```ts
async function openPinnedWorkspaceTab(workspace: Workspace, tab: WorkspaceTab) {
  if (tab.openTabId && await tabExists(tab.openTabId)) {
    await chrome.tabs.update(tab.openTabId, { active: true });
    return;
  }

  const created = await chrome.tabs.create({
    windowId: primaryWindowId,
    url: tab.url,
    index: tab.order,
    active: true,
  });

  await chrome.tabs.group({
    tabIds: created.id,
    groupId: runtimeBinding.groupId,
  });
}
```

### 关闭固定标签页

当 Chrome tab 被关闭时：

- 如果它绑定的是固定 `WorkspaceTab`，只清空 `openTabId`，保留 `WorkspaceTab`。
- 如果它绑定的是普通 tab，从 workspace 中删除该项。

这样可以实现“固定 tab 即使关闭页面，在 workspace 里也不会消失”。

### 固定标签页的位置

固定标签页重新打开时，应该尽量回到它在 workspace 里的 `order` 位置。

如果 Chrome 当前标签组里已有其他标签页，创建时用保存的 `order` 计算目标 index。创建后再重新 snapshot，确保实际顺序与存储状态一致。

## 恢复流程

从存储数据重新打开主窗口时：

1. 创建一个新的 Chrome 窗口。
2. 把新窗口的 `windowId` 存为 `primaryWindowId`。
3. 按 `order` 遍历每个 workspace：
   - 打开 workspace 里需要恢复的标签页。
   - 把这些标签页分组。
   - 设置标签组标题和颜色。
   - 恢复折叠状态。
4. 尽量恢复之前的 active workspace。
5. 尽量恢复之前的 active URL。

第一版恢复时可以只自动打开固定标签页，普通标签页是否恢复可以作为后续偏好项。这样 workspace 的长期结构更稳定，不会把临时浏览痕迹全部恢复回来。

如果 workspace 没有任何需要恢复的标签页，第一版可以不创建标签页。后续可以给空 workspace 加占位页。

## Workspace 排序

Workspace 的长期顺序存为 `order`。

运行时，Chrome 标签组顺序可以通过每个组的第一个标签页 index 推导。

用户把一个 workspace 拖到另一个 workspace 上时：

```ts
await chrome.tabGroups.move(sourceGroupId, {
  index: targetGroupFirstTabIndex,
});
```

移动完成后重新 snapshot，并更新存储里的 `order`。

## 标签页移动

把标签页拖到另一个标签页上时，需要根据落点判断插入位置：

- 落在目标标签页上半部分：插到目标标签页前面。
- 落在目标标签页下半部分：插到目标标签页后面。

把标签页拖到 workspace 空白区域时，移动到该 workspace 最后。

把标签页拖到未分组区域时，从当前 workspace 标签组里移出。

固定标签页和普通标签页都可以参与排序。排序完成后更新 `WorkspaceTab.order`。

## Chrome API 映射

- 获取当前窗口：`chrome.windows.getCurrent()`
- 聚焦主窗口：`chrome.windows.update(windowId, { focused: true })`
- 创建主窗口：`chrome.windows.create({ focused: true })`
- 查询标签页：`chrome.tabs.query(...)`
- 移动标签页：`chrome.tabs.move(tabIds, { windowId, index })`
- 创建或加入标签组：`chrome.tabs.group({ tabIds, groupId })`
- 移出标签组：`chrome.tabs.ungroup(tabIds)`
- 查询标签组：`chrome.tabGroups.query(...)`
- 更新标签组：`chrome.tabGroups.update(groupId, ...)`
- 移动标签组：`chrome.tabGroups.move(groupId, { index })`
- 创建标签页：`chrome.tabs.create(...)`
- 持久化状态：`chrome.storage.local`

## 产品规则

- 主窗口是 workspace 的主基地。
- 临时窗口是临时草稿空间。
- 临时窗口可以把标签页送回主窗口。
- 临时窗口不能从侧边栏变成主窗口。
- 主窗口关闭后，由用户显式重新打开。
- Workspace 身份来自扩展存储，不来自 Chrome 标签组 ID。
- 固定标签页是 workspace 的长期结构，关闭页面不会删除它。
- 普通标签页是当前会话内容，关闭页面后会从 workspace 中移除。
