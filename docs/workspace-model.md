# 窗口、Workspace 与标签页模型

这个扩展把 Chrome 标签组当成轻量版 Arc workspace 来使用，但 workspace 只属于一个“主窗口”。其他 Chrome 窗口都是临时窗口，可以把标签页送回主窗口，但不参与完整 workspace 管理。

## 目标

- 让 workspace 行为可预测。
- 让 workspace 持久化，不依赖 Chrome 会话级 ID。
- 避免一开始就处理复杂的跨窗口同步。
- 允许临时窗口存在，但不污染 workspace 状态。
- 主窗口被关闭后，可以从书签树恢复 workspace。

## 核心概念

### 主窗口

主窗口是唯一启用 workspace 管理能力的 Chrome 窗口。

- 扩展刚安装或启动初始化时，如果没有主窗口，当前窗口成为主窗口。
- 初始化完成后，如果没有主窗口，下一个新打开的窗口成为主窗口。
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

### Bookmark-backed Workspace

Workspace 是扩展自己的长期结构，但静态数据存放在 Chrome 书签树里。Chrome 标签组只是 workspace 在主窗口里的运行时投影。

长期数据不能依赖 `tabGroupId`，因为 Chrome 的标签组 ID 只在当前浏览器会话里稳定。Workspace 的稳定 ID 使用书签文件夹 ID。

扩展维护一个根书签目录：

```text
Chrome Workspace
  [blue] Work
    GitHub
    Gmail
  [green] Personal
    Notes
```

映射规则：

- 根目录 `Chrome Workspace` 是扩展管理的 workspace 根。
- 每个 workspace 是根目录下的一个书签文件夹。
- 每个固定标签页是 workspace 文件夹下的一个 bookmark。
- Workspace 顺序使用书签文件夹顺序。
- 固定标签页顺序使用 bookmark 顺序。
- Workspace 名称和颜色写在文件夹 title 里。

Workspace 文件夹 title 使用：

```text
[blue] Work
```

解析规则：

```ts
const WORKSPACE_TITLE_RE = /^\[(grey|blue|red|yellow|green|pink|purple|cyan|orange)\]\s*(.*)$/;
```

如果 title 没有颜色前缀，默认颜色为 `grey`，完整 title 作为 workspace 名称。

```ts
type Workspace = {
  id: string; // bookmark folder id
  name: string;
  color: chrome.tabGroups.TabGroup["color"];
  tabs: WorkspaceTab[];
  activeUrl?: string;
  collapsed?: boolean;
  order: number;
};

type WorkspaceTab = {
  id: string; // bookmark id
  url: string;
  title?: string;
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

## 运行时状态

```ts
type RuntimeWorkspaceState = {
  activeWorkspaceId?: string;
};
```

Workspace 静态结构不存 `chrome.storage.local`，而是存 Chrome 书签树。运行时状态可以放内存里，主窗口 ID 只保存在 `WindowModel` 的内存状态里。

`groupId` 和 `tabId` 不能作为长期可信数据保存。它们可以作为运行时缓存，但必须按会话级 ID 对待。

## 主窗口行为

侧边栏打开时：

1. 使用 `chrome.windows.getCurrent()` 获取当前窗口。
2. 读取运行时 workspace 状态。
3. 如果当前 `windowId === primaryWindowId`，渲染完整 workspace UI。
4. 否则渲染临时窗口 UI。

如果没有 `primaryWindowId`，当前已经存在的窗口仍然按临时窗口处理。用户可以通过 `Open main window` 打开新的主窗口。

例外：扩展刚安装或启动初始化时，如果还没有主窗口，会把当前窗口注册为主窗口，避免首次打开侧边栏时被误判为临时窗口。

完整 workspace UI 包括：

- 展示 workspace 列表。
- 创建 workspace，入口使用 `+` 图标。
- 重命名 workspace。
- 修改 workspace 颜色，入口使用 Chrome 风格颜色圆点。
- 折叠或展开 workspace，入口使用显示或隐藏图标。
- 删除 workspace，入口使用删除图标，并且必须二次确认。
- 拖动 workspace 排序。
- 在 workspace 之间拖动标签页。
- 把当前激活标签页送入 workspace。
- 固定或取消固定 workspace 内的标签页。
- 从书签树恢复缺失的 workspace。

### Workspace UI 操作

主窗口侧边栏的 workspace 操作用轻量 icon 表达，避免用长文字按钮占用空间。

顶部工具区：

- `+`：新建 workspace。
- `Refresh` 图标：刷新当前主窗口 tab、tab group 和 workspace 运行时绑定。

点击 `+` 新建 workspace 时，目标行为是：

1. 在 `Chrome Workspace` 根书签目录下创建一个新的 workspace 文件夹。
2. 文件夹 title 使用默认颜色和默认名称，例如 `[grey] Untitled workspace`。
3. 在主窗口创建一个新标签页，作为该 workspace 的初始页面。
4. 把新标签页加入新 workspace 对应的 Chrome 标签组。
5. 聚焦新标签页，并让 workspace 标题进入可编辑状态。

Workspace 头部操作：

- 标题输入框用于重命名 workspace。
- 颜色圆点用于选择 workspace 颜色，颜色集合与 Chrome tab group 对齐。
- 显示或隐藏图标用于折叠、展开 workspace。
- 删除图标用于删除 workspace。

删除 workspace 必须二次确认。确认后目标行为是：

1. 删除对应 workspace 书签文件夹。
2. 移除或关闭对应运行时 Chrome 标签组里的普通标签页。
3. 对已经固定为书签的标签页，以书签删除结果为准，不再作为可恢复项显示。
4. 刷新主窗口运行时绑定。

第一版实现可以先使用浏览器原生确认框，后续再替换为扩展内确认弹层。

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
3. 从书签树里的 workspace 数据恢复主窗口。

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

- 保留书签树里的 workspace 数据。
- 把内存里的 `primaryWindowId` 清空。
- 已存在的其他窗口仍然是临时窗口。
- 临时窗口侧边栏显示 `Main window is closed` 状态。

此时可用操作：

- `Reopen main window`
- `Send current tab to reopened main window`
- `Send all tabs to reopened main window`

这样可以避免用户困惑：某个临时窗口不应该突然变成 workspace 主基地。

## Workspace 持久化

Workspace 静态结构由 Chrome 书签树持久化和同步，不需要扩展自己同步 workspace 列表。

需要持久化的长期动作直接映射为书签操作：

- 创建 workspace：创建书签文件夹。
- 重命名 workspace：更新书签文件夹 title。
- 修改 workspace 颜色：更新书签文件夹 title。
- 排序 workspace：移动书签文件夹。
- 固定标签页：创建 bookmark。
- 取消固定标签页：删除 bookmark。
- 排序固定标签页：移动 bookmark。
- 更新固定标签页标题或 URL：更新 bookmark。

需要运行时同步的内容仍然通过扫描主窗口恢复：

1. 用 `chrome.tabs.query({ windowId: primaryWindowId })` 查询主窗口标签页。
2. 用 `chrome.tabGroups.query({ windowId: primaryWindowId })` 查询主窗口标签组。
3. 读取 `Chrome Workspace` 根目录下的 workspace 文件夹。
4. 按书签文件夹 ID 绑定 workspace。
5. 将已打开的 Chrome tab 与 workspace bookmark 建立运行时绑定。

未分组标签页第一版可以保持未分组，不必作为 workspace 持久化。

运行时要区分固定标签页和普通标签页：

- 固定标签页即使当前没有打开的 Chrome tab，也仍然保留为 bookmark。
- 普通标签页关闭后不写入书签树。
- 如果一个固定标签页当前打开着，用 `openTabId` 记录它的运行时 tab ID。
- `openTabId` 不能作为长期可信数据，只能作为当前会话的运行时绑定。

## Bookmark 操作

Workspace 静态结构通过 `chrome.bookmarks` API 管理。

核心方法：

- `ensureWorkspaceRootFolder()`
- `listWorkspaces()`
- `createWorkspace({ name, color })`
- `renameWorkspace(id, name)`
- `updateWorkspaceColor(id, color)`
- `reorderWorkspace(id, index)`
- `addPinnedTab(workspaceId, tab)`
- `removePinnedTab(tabBookmarkId)`
- `reorderPinnedTab(tabBookmarkId, index)`
- `updatePinnedTab(tabBookmarkId, { title, url })`

Workspace title 格式化：

```ts
function formatWorkspaceTitle(name: string, color: chrome.tabGroups.TabGroup["color"]) {
  return `[${color}] ${name.trim() || "Untitled workspace"}`;
}
```

Workspace title 解析：

```ts
function parseWorkspaceTitle(title: string) {
  const match = title.match(WORKSPACE_TITLE_RE);

  if (!match) {
    return {
      color: "grey",
      name: title || "Untitled workspace",
    };
  }

  return {
    color: match[1],
    name: match[2] || "Untitled workspace",
  };
}
```

## 固定标签页

Workspace 内的标签页可以被固定。固定后的标签页属于 workspace 的长期结构，而不只是当前打开的 Chrome tab。

### 标签页 UI 状态

Workspace 里的标签页 UI 由四部分组成：

- 左侧 favicon：显示当前页面 icon；没有 favicon 时显示默认页面图标。
- 标题区域：显示 tab 标题或固定书签名。
- 状态区域：显示固定状态、dirty 状态等轻量 icon。
- 右侧操作区：显示固定星标和关闭图标。

标签页有四种产品状态：

- 未固定 live tab：只代表当前打开的 Chrome tab，星标为空。
- 已固定且 URL 匹配：对应 workspace 书签，星标亮起，标题显示书签名。
- 已固定但 URL 偏离：星标亮起，显示 dirty 圆点，标题显示 `书签名 · 当前标签名`。
- 已固定但 live tab 已关闭：没有当前 Chrome tab，但 bookmark 仍保留在 workspace 中，点击后可以恢复。

Dirty 状态用于表达“这个打开着的标签页已经离开它绑定的书签 URL”。它不自动更新书签 URL，也不自动取消固定，只提醒用户当前页面和可恢复书签已经不同。

固定 tab 的标题来源规则：

1. 如果 tab 已固定，主标题使用 bookmark title。
2. 如果 tab 已固定且 dirty，主标题后追加当前 Chrome tab title。
3. 如果 tab 未固定，标题使用 Chrome tab title。
4. 如果没有标题，使用 URL；仍然没有则显示“未命名标签页”。

固定星标操作：

- 点击空星标：把当前 tab 固定到所属 workspace，创建 bookmark。
- 点击亮星标：取消固定，必须二次确认。
- 取消固定确认后，删除对应 bookmark；如果当前 Chrome tab 仍打开，它会变成普通 live tab。
- 取消固定不会自动关闭当前 Chrome tab。

关闭图标操作：

- 未固定 live tab：关闭 Chrome tab，并从 workspace UI 中移除。
- 已固定且 live tab 打开：关闭 Chrome tab，但保留 bookmark，workspace 中仍显示这个固定 tab。
- 已固定但 live tab 已关闭：关闭图标可以隐藏或禁用，因为没有可关闭的 Chrome tab。

点击标签页标题区域：

- 未固定 live tab：激活当前 Chrome tab。
- 已固定且 live tab 打开：激活当前 Chrome tab。
- 已固定但 live tab 已关闭：在原 workspace 位置重新打开 bookmark URL。

固定标签页的行为：

- 固定标签页关闭页面后，仍然作为 bookmark 保留在对应 workspace 里。
- 固定标签页再次被点击时，在它原本的位置重新打开对应 URL。
- 重新打开后，要加入对应 workspace 的 Chrome 标签组。
- 固定标签页的顺序保存在 `WorkspaceTab.order`。
- 固定标签页可以拖动排序。
- 固定标签页可以取消固定；取消固定会删除对应 bookmark。

普通标签页的行为：

- 普通标签页只代表当前打开的 Chrome tab。
- 普通标签页关闭后，从 workspace 中移除。
- 普通标签页可以被固定，固定后创建对应 bookmark。

### 点击固定标签页

点击 workspace 里的固定标签页时：

1. 如果 `openTabId` 仍然有效，直接激活该 Chrome tab。
2. 如果 `openTabId` 已失效或不存在，在该 workspace 对应位置创建新标签页。
3. 新标签页 URL 使用 `WorkspaceTab.url`。
4. 新标签页加入该 workspace 对应 Chrome 标签组。
5. 更新运行时 `openTabId` 绑定。

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

- 如果它绑定的是固定 `WorkspaceTab`，只清空 `openTabId`，保留 bookmark。
- 如果它绑定的是普通 tab，不需要更新书签树。

这样可以实现“固定 tab 即使关闭页面，在 workspace 里也不会消失”。

### 固定标签页的位置

固定标签页重新打开时，应该尽量回到它在 workspace 里的 `order` 位置。

如果 Chrome 当前标签组里已有其他标签页，创建时用保存的 `order` 计算目标 index。创建后再刷新运行时绑定，确保实际顺序与书签顺序一致。

## 恢复流程

从书签树重新打开主窗口时：

1. 创建一个新的 Chrome 窗口。
2. 把新窗口的 `windowId` 存为 `primaryWindowId`。
3. 按书签文件夹顺序遍历每个 workspace：
   - 打开 workspace 里需要恢复的标签页。
   - 把这些标签页分组。
   - 设置标签组标题和颜色。
   - 恢复折叠状态。
4. 尽量恢复之前的 active workspace。
5. 尽量恢复之前的 active URL。

第一版恢复时只自动打开固定标签页。普通标签页不是书签结构的一部分，不需要恢复。

如果 workspace 没有任何需要恢复的标签页，第一版可以不创建标签页。后续可以给空 workspace 加占位页。

## Workspace 排序

Workspace 的长期顺序由书签文件夹顺序决定。

运行时，Chrome 标签组顺序可以通过每个组的第一个标签页 index 推导。

用户把一个 workspace 拖到另一个 workspace 上时：

```ts
await chrome.tabGroups.move(sourceGroupId, {
  index: targetGroupFirstTabIndex,
});
```

移动完成后同步移动对应书签文件夹。

## 标签页移动

把标签页拖到另一个标签页上时，需要根据落点判断插入位置：

- 落在目标标签页上半部分：插到目标标签页前面。
- 落在目标标签页下半部分：插到目标标签页后面。

把标签页拖到 workspace 空白区域时，移动到该 workspace 最后。

把标签页拖到未分组区域时，从当前 workspace 标签组里移出。

固定标签页和普通标签页都可以参与排序。固定标签页排序完成后移动对应 bookmark；普通标签页只调整运行时 Chrome tab 顺序。

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
- 查询书签树：`chrome.bookmarks.getTree(...)`
- 查询子节点：`chrome.bookmarks.getChildren(...)`
- 创建书签或文件夹：`chrome.bookmarks.create(...)`
- 更新书签或文件夹：`chrome.bookmarks.update(...)`
- 移动书签或文件夹：`chrome.bookmarks.move(...)`
- 删除书签或文件夹：`chrome.bookmarks.remove(...)`

## 产品规则

- 主窗口是 workspace 的主基地。
- 临时窗口是临时草稿空间。
- 临时窗口可以把标签页送回主窗口。
- 临时窗口不能从侧边栏变成主窗口。
- 主窗口关闭后，由用户显式重新打开。
- Workspace 身份来自书签文件夹 ID，不来自 Chrome 标签组 ID。
- 固定标签页是 workspace 的长期结构，关闭页面不会删除它。
- 普通标签页是当前会话内容，关闭页面后会从 workspace 中移除。
- Workspace 静态结构依赖 Chrome 书签同步，不自己实现云同步。
- Workspace 创建入口是 `+` 图标，而不是“分组当前标签页”的文字按钮。
- Workspace 颜色选择使用 Chrome 风格颜色圆点，不在主界面展示长颜色名。
- Workspace 隐藏、显示、删除都使用 icon 表达；删除必须二次确认。
- 固定标签页使用星标表达，亮星表示它已经写入 workspace 对应书签目录。
- 取消固定必须二次确认，确认后删除 bookmark，但不关闭当前 Chrome tab。
- 固定标签页离开 bookmark URL 后显示 dirty 圆点，并保留原 bookmark title。
- 已固定标签页关闭后仍保留在 workspace 中，再点击时按 bookmark URL 恢复。
- Tab 行的关闭图标只关闭运行时 Chrome tab，不直接删除固定 bookmark。
