# Workspace 模型

Workspace 模型定义 Harbor 的长期工作区结构，以及它和 Chrome Group 的运行时映射。完整产品规则以 [产品逻辑文档](./产品逻辑文档.md) 为准。

## 目标

- Workspace 长期结构可同步、可恢复。
- Workspace 身份不依赖 Chrome 会话级 ID。
- Workspace 只管理 Harbor Page，不直接拥有 Chrome Tab。
- Chrome Group 只是 Workspace 在主窗口里的运行时投影。
- Workspace 排序有明确的长期来源。

## 长期结构

Harbor 使用 Chrome 书签树保存 Workspace 静态结构。

```text
Harbor Workspace
  [blue] Work
    GitHub
    Gmail
  [green] Personal
    Notes
```

规则：

- 根目录固定为 `Harbor Workspace`。
- 每个 Workspace 是根目录下的一个书签文件夹。
- Workspace ID 使用书签文件夹 ID。
- Workspace 顺序使用根目录下文件夹顺序。
- Workspace 名称、颜色和显示/隐藏状态写在文件夹 title 上。
- Workspace 文件夹下的 Bookmark 表示 Pinned Page。
- Temp Page 不写入 Workspace 文件夹。

Workspace 文件夹 title 格式：

```text
[blue] Work
[blue:hidden] Work
```

解析规则：

```ts
const WORKSPACE_TITLE_RE = /^\[(grey|blue|red|yellow|green|pink|purple|cyan|orange)(?::(shown|hidden))?\]\s*(.*)$/;
```

如果没有颜色前缀：

- 颜色默认为 `grey`。
- 完整 title 作为 Workspace 名称。
- 显示/隐藏状态默认为显示。

如果没有 `:hidden` 状态：

- Workspace 默认为显示。
- 旧格式 `[blue] Work` 继续有效。

## 数据结构模板

```ts
type Workspace = {
  id: string; // bookmark folder id
  name: string;
  color: chrome.tabGroups.TabGroup["color"];
  collapsed: boolean;
  order: number;
  pages: Page[];
};
```

运行时可以附加：

```ts
type RuntimeWorkspaceBinding = {
  workspaceId: string;
  groupId: number; // Chrome Group id
};
```

`groupId` 只能作为当前浏览器会话里的运行时绑定，不能作为长期 ID。

## Chrome Group 映射

一个 Workspace 在主窗口里最多绑定一个 Chrome Group。

映射规则：

- Workspace 文件夹 ID 是长期身份。
- Chrome Group ID 是运行时投影身份。
- Chrome Group 标题使用 Workspace 名称。
- Chrome Group 颜色使用 Workspace 颜色。
- Workspace 显示/隐藏状态来自 Bookmark folder title。
- Chrome Group 折叠状态只是 Workspace 显示/隐藏状态的运行时投影。
- Workspace 通过 Page 绑定 Chrome Tab，不直接维护 Chrome Tab 列表。

当 Workspace 没有任何打开的 Page 时：

- 对应 Chrome Group 可以不存在。
- Workspace 仍然存在于书签树。
- 点击关闭态 Pinned Page 时，Harbor 用新创建的 Chrome Tab 创建对应 Chrome Group。

## 创建与空 Workspace

创建空 Workspace 时：

1. 在 `Harbor Workspace` 根目录下创建 Workspace 文件夹。
2. 文件夹 title 使用 `[color] name` 格式。
3. 不立即创建 Chrome Group。
4. 不立即创建 Chrome Tab。

第一次打开 Workspace 内 Page 时：

1. 如果 Workspace 没有绑定 Chrome Group，先用新 Chrome Tab 创建 Chrome Group。
2. 把该 Chrome Tab 绑定到对应 Page。
3. 把 Chrome Group 绑定到 Workspace。

## Chrome 创建或恢复的 Group

Chrome 手动创建或 session restore 出来的 Chrome Group 不是 Harbor 长期状态来源。

Harbor 在扫描主窗口时按名称和颜色尝试匹配 Workspace：

- 匹配且 Workspace 未打开：绑定该 Chrome Group。
- 匹配且 Workspace 已打开：把该 Chrome Group 内 Chrome Tab 合并进已绑定 Workspace 的 Chrome Group。
- 不匹配：作为 unmanaged Chrome Group 显示。

匹配只是运行时绑定策略，不会创建或覆盖 Workspace 文件夹。

## Chrome Group 解散

当 Workspace 对应 Chrome Group 被用户在 Chrome 里解散时：

- Workspace 保留。
- Pinned Page 保留 Bookmark。
- 已绑定 Chrome Tab 的 Pinned Page 清理运行时绑定，进入关闭态 Pinned Page。
- 原 Chrome Group 内没有 Bookmark 身份的 Chrome Tab 进入 unmanaged 区。
- 不删除 Workspace 文件夹。
- 不删除 Pinned Page 的 Bookmark。

## Workspace 操作

### 创建

1. 创建 Workspace 书签文件夹。
2. 不创建 Chrome Group，直到首次打开 Page。
3. 不创建默认 Chrome Tab。

### 重命名

1. 更新 Workspace 文件夹 title。
2. 如果当前存在绑定的 Chrome Group，同步更新 Chrome Group title。

### 修改颜色

1. 更新 Workspace 文件夹 title 里的颜色前缀。
2. 如果当前存在绑定的 Chrome Group，同步更新 Chrome Group color。

### 显示与隐藏

1. 更新 Workspace 文件夹 title 里的显示/隐藏状态。
2. 如果当前存在绑定的 Chrome Group，同步更新 Chrome Group collapsed。
3. 如果当前没有绑定 Chrome Group，只更新 Bookmark；下次创建 Chrome Group 时再应用该状态。

### 删除

1. 二次确认。
2. 删除 Workspace 书签文件夹。
3. 清理对应运行时 Chrome Group 绑定。
4. Pinned Page 对应的 Bookmark 随文件夹删除。
5. 已打开 Chrome Tab 的处理策略应显式执行：可以关闭，也可以释放到 unmanaged 区，但不能保留为 Harbor Pinned Page。

## Workspace 排序

Workspace 的长期排序来源是 `Harbor Workspace` 根目录下的文件夹顺序。

Harbor managed 的 Workspace 顺序与 Chrome Group 顺序脱钩。

拖动 Workspace 时：

1. 移动 Workspace 书签文件夹。
2. 不移动 Chrome Group。
3. 刷新 Harbor runtime 绑定。

Chrome Group 排序只是运行时投影：

- 不能作为 Workspace 长期顺序来源。
- 不需要与 Harbor managed 侧边栏顺序一致。
- 下次恢复时仍以书签文件夹顺序为准。

## 与 Page 的关系

Workspace 只负责容器身份和 Workspace 顺序：

- Pinned Page 的长期结构由 Workspace 文件夹下的 Bookmark 保存。
- Temp Page 是当前打开 Chrome Tab 的运行时表达，不写入 Workspace 文件夹。
- Workspace 不直接拥有 Chrome Tab。
- Pinned Page 可以跨 Workspace 拖动，本质是把对应 Bookmark 移动到目标 Workspace 文件夹。
- Pinned Page 跨 Workspace 后仍然是 Pinned Page，不会变成 Temp Page。
- 如果跨 Workspace 的 Pinned Page 当前绑定 Chrome Tab，只确保 Chrome Tab 位于目标 Workspace 对应 Chrome Group，不同步 Chrome Tab index。
- Workspace 内 Page 的详细状态和排序见 [Page 模型](./page-model.md)。

## Unmanaged

不匹配任何 Workspace 的 Chrome Group 或 Chrome Tab 显示在 unmanaged 区。

规则：

- Unmanaged 区不写 Bookmark。
- Unmanaged 区不改变 Harbor managed 排序。
- Harbor 管理区排在 unmanaged 区前面。
- unmanaged Chrome Tab 可以被移动到 Workspace，成为该 Workspace 的 Temp Page。
- unmanaged Chrome Group 可以按匹配规则绑定或合并进 Workspace。
- Unmanaged 区排序跟随 Chrome 当前 Window / Group / Tab 顺序。

## 不做的事

- 不把 Workspace 列表存入 `chrome.storage.local`。
- 不把 Chrome Group ID 写成长期数据。
- 不让 Chrome session restore 覆盖 `Harbor Workspace` 书签结构。
- 不把 Harbor Page 简称为 Tab。
