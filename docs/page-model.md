# Page 模型

Page 模型定义 Mooring 的页面单位，以及 Page 与 Chrome Tab、Bookmark 的关系。

## 目标

- 区分 Mooring Page 和 Chrome Tab。
- 支持 Pinned Page 关闭后仍保留。
- 支持 Temp Page 作为当前打开但未固定的临时页面。
- 明确 Page 排序、恢复、dirty、拖动和解绑规则。

## Page 类型

### Temp Page

Temp Page 是 Mooring 对当前打开 Chrome Tab 的临时表达。

特点：

- 一定绑定一个 Chrome Tab。
- 没有 bookmark。
- 不写入 `Mooring Workspace` 书签树。
- 关闭 Chrome Tab 后消失。
- 可以通过星标变成 Pinned Page。

### Pinned Page

Pinned Page 是 Mooring 的长期 Page。

特点：

- 对应一个 bookmark。
- 只能出现在 Workspace 内。
- 可以绑定一个 Chrome Tab，也可以没有 Chrome Tab。
- 关闭 Chrome Tab 后仍然保留在 Workspace。
- 点击关闭态 Pinned Page 会重新创建 Chrome Tab。
- 标题使用 bookmark title。
- URL 使用 bookmark URL。

### Dirty Pinned Page

当 Pinned Page 当前绑定的 Chrome Tab URL 与 bookmark URL 不一致时，它是 dirty 状态。

表现：

- 星标仍然亮起。
- 显示 dirty 标识。
- 标题显示 `bookmark title · current Chrome Tab title`。
- 不自动更新 bookmark URL。
- 不自动取消固定。
- dirty 标识是可点击恢复入口，点击后把当前 Chrome Tab 导回 bookmark URL。

## 数据结构模板

```ts
type PageKind = "temp" | "pinned";

type Page = {
  id: string; // "chrome-tab:<chromeTabId>" 或 "bookmark:<bookmarkId>"
  kind: PageKind;
  title: string;
  currentTitle?: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
  order: number;
  pinned: boolean;
  dirty: boolean;
  open: boolean;
  chromeTabId?: number;
  bookmarkId?: string;
};
```

ID 规则：

- Temp Page：`chrome-tab:<chromeTabId>`
- Pinned Page：`bookmark:<bookmarkId>`

Pinned Page 打开后仍然以 `bookmark:<bookmarkId>` 作为 Mooring identity，避免关闭/恢复后 identity 改变。

## Chrome Tab 映射

Temp Page：

- 直接绑定一个 Chrome Tab。
- Chrome Tab 关闭后，Temp Page 消失。

Pinned Page：

- 长期绑定 bookmark。
- 打开时临时绑定 Chrome Tab。
- `bookmarkId <-> chromeTabId` 绑定只在当前运行时有效。
- 该绑定可以缓存在 `chrome.storage.session`，用于 service worker 唤醒后避免重复打开同一个 Pinned Page。
- 使用缓存前必须确认 Chrome Tab 仍然存在；不存在时清理缓存并按关闭态 Pinned Page 处理。

打开 Pinned Page：

1. 如果 bookmark 已绑定仍然存在的 Chrome Tab，激活该 Chrome Tab。
2. 如果没有绑定 Chrome Tab，用 bookmark URL 创建新的 Chrome Tab。
3. 如果 Workspace 没有 Chrome Group，用新 Chrome Tab 创建 Chrome Group。
4. 如果 Workspace 已有 Chrome Group，把新 Chrome Tab 加入该 Chrome Group。
5. 更新 runtime binding。

关闭 Pinned Page 的 Chrome Tab：

- 关闭 Chrome Tab。
- 清理 runtime binding。
- 保留 bookmark。
- 保留 Pinned Page。

## Bookmark 映射

Pinned Page 的长期数据来自 bookmark：

```ts
type PinnedPageBookmark = {
  id: string;
  title: string;
  url: string;
  order: number;
};
```

规则：

- bookmark title 是 Pinned Page 的可编辑标题。
- bookmark URL 是恢复时打开的 URL。
- bookmark 顺序是 Pinned Page 的长期顺序。

## 固定与取消固定

### Temp Page 固定

1. 用户点击星标。
2. 在当前 Workspace 文件夹下创建 bookmark。
3. 创建 Pinned Page。
4. 保持当前 Chrome Tab 打开并绑定到新 Pinned Page。

### Pinned Page 取消固定

1. 用户点击亮星标。
2. 二次确认。
3. 删除 bookmark。
4. 如果 Chrome Tab 仍打开，它变成 Temp Page。
5. 不关闭 Chrome Tab。

## 显示规则

Workspace 内只有一条 Page 列表，Pinned Page 和 Temp Page 可以自由混排。

规则：

- Pinned Page 通过星标和 bookmark 身份识别。
- Temp Page 通过未星标状态识别。
- Temp Page 可以通过星标变成 Pinned Page，并保留当前 UI 位置。
- Pinned Page 取消固定后，如果仍有 Chrome Tab，则变成 Temp Page，并保留当前 UI 位置。

## 排序规则

Mooring managed Page 顺序与 Chrome Tab index 脱钩。

- Workspace Page 顺序：来自 Mooring runtime 顺序，可混排 Pinned Page 和 Temp Page。
- Pinned Page 长期相对顺序：同步到 bookmark 顺序。
- Unmanaged Page 顺序：来自 Chrome Tab index。

### UI 顺序

拖动时传递的是 Page 在 Workspace 当前列表里的 UI 位置。

原因：

- 关闭态 Pinned Page 没有 Chrome Tab index。
- Pinned Page 和 Temp Page 可以混排。
- Chrome Tab index 不代表 Mooring managed Page 顺序。

### Workspace Page 顺序

- 来源是 Mooring runtime 顺序。
- Pinned Page 和 Temp Page 都可以在 Workspace 内自由排序。
- 关闭态和打开态 Pinned Page 都可以排序。
- Temp Page 可以和 Pinned Page 混排。
- Pinned Page 可以拖到另一个 Workspace。
- Pinned Page 只能在 Workspace 内或 Workspace 之间拖动，不能拖到 unmanaged。
- 跨 Workspace 拖动时，移动对应 bookmark 到目标 Workspace 文件夹。
- 跨 Workspace 后，该 Page 仍然是 Pinned Page，只是归属 Workspace 改为目标 Workspace。
- 如果 Pinned Page 已绑定 Chrome Tab，只确保 Chrome Tab 位于目标 Workspace 对应 Chrome Group。
- 不同步 Chrome Tab index。
- 如果目标 Workspace 没有 Chrome Group，则用该 Chrome Tab 创建目标 Workspace 的 Chrome Group；关闭态 Pinned Page 跨 Workspace 移动时不创建 Chrome Tab 或 Chrome Group。
- Pinned Page 的 bookmark 顺序只记录 Pinned Page 彼此之间的长期相对顺序。

## 恢复位置

点击关闭态 Pinned Page 时，新 Chrome Tab 只需要进入目标 Workspace 的 Chrome Group：

1. 如果 Workspace 没有 Chrome Group，用新 Chrome Tab 创建 Chrome Group。
2. 如果 Workspace 已有 Chrome Group，把新 Chrome Tab 加入该 Chrome Group。
3. 不按 Pinned Page 顺序计算 Chrome Tab index。
4. Chrome Tab 可以放在 Chrome Group 末尾。

## 拖动入口

- Page 整行都可以拖动。
- 拖动时高亮 Page 之间的插入缝隙，drop 后插入到该缝隙对应的位置。
- 标题点击用于打开 Page。
- Pinned Page 标题旁编辑按钮用于修改 bookmark title。
- 输入框编辑时不能触发拖动。

## Unmanaged Page

Unmanaged 区域里的 Chrome Tab 可以显示为 unmanaged Temp Page。

- 不写 bookmark。
- 不属于任何 Workspace。
- 可以被移动到 Workspace，成为该 Workspace 的 Temp Page。

## 不做的事

- 不把 Mooring Page 简称为 Tab。
- 不用 Chrome Tab ID 作为 Pinned Page identity。
- 不把 `chrome.storage.session` 里的 Chrome Tab ID 当长期身份。
- 不让关闭 Chrome Tab 删除 Pinned Page。
- 不自动把 dirty Page 当前 URL 写回 bookmark。
