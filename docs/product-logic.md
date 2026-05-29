# Mooring 产品逻辑文档

本文档是 Mooring 的产品规则源头。拆分模型文档负责展开具体结构：

- [Window 模型](./window-model.md)
- [Workspace 模型](./workspace-model.md)
- [Page 模型](./page-model.md)
- [AI Action 执行计划](./ai-action-plan.md)

## 术语

- `Window`：Chrome Window。
- `Chrome Tab`：Chrome 真实打开的浏览器标签页。
- `Chrome Group`：Chrome 原生标签组。
- `Workspace`：Mooring 管理的工作区，对应 `Mooring Workspace` 根目录下的一个书签文件夹。
- `Page`：Mooring 管理的基本页面单位。
- `Pinned Page`：长期存在于 Workspace 的 Page，对应一个 bookmark；可以绑定 Chrome Tab，也可以处于关闭态。
- `Temp Page`：临时 Page，一定绑定一个 Chrome Tab，不写入 bookmark。
- `Bookmark`：Chrome bookmark，用于保存 Pinned Page。
- `Runtime Binding`：Mooring 运行时维护的 Workspace / Page 与 Chrome Group / Chrome Tab 的绑定关系。
- `Unmanaged`：当前主窗口里不属于 Mooring Workspace 的 Chrome Tab 或 Chrome Group。

产品文档中不使用 `Tab` 指代 Mooring 管理对象；`Tab` 只作为 `Chrome Tab` 的简称出现在 Chrome 语境中。

## App 规则

- Mooring 的长期数据只来自 Chrome bookmark。
- Mooring 的运行时投影来自当前主窗口里的 Chrome Group 和 Chrome Tab。
- Mooring 可以用 `chrome.storage.session` 缓存运行时绑定，用来跨 service worker 唤醒恢复上下文；它不是长期状态来源。
- Mooring 不把 Chrome session restore 当成长期状态来源。
- Mooring 只在主窗口启用完整 Workspace / Page 管理。
- 临时窗口只提供把 Chrome Tab 发送到主窗口的能力。

## 实现模型边界

产品概念在代码中对应为：

- `AppModel`：service worker 侧应用协调器，接收 side panel message，组合各领域模型。
- `WindowModel`：Chrome Window 角色和主窗口运行时状态。
- `WorkspaceModel`：Workspace 容器、Bookmark folder、Workspace 排序、Workspace 与 Chrome Group 投影。
- `WorkspacePageModel`：Workspace 内 Page 生命周期和 Page 排序。
- `UnmanagedModel`：未管理 Chrome Tab / Chrome Group。
- `WorkspaceRuntimeStore`：运行时绑定、`chrome.storage.session` 缓存和 Workspace Page runtime order。

边界规则：

- Workspace 容器逻辑不处理 unmanaged Chrome Group 的改名、改色、解散和 unmanaged 排序。
- Page 生命周期逻辑不处理 Workspace folder 的创建、重命名、颜色和排序。
- Unmanaged 逻辑不写 Bookmark，不创建 Workspace，不承担 Workspace 语义。
- Runtime binding 不是长期状态，不能越过 `WorkspaceRuntimeStore` 变成散落的持久化逻辑。

## 窗口管理逻辑

只有主窗口会被 Mooring 管理，其他窗口都是临时窗口。

### 主窗口

- 首次安装或初始化时，如果没有主窗口，当前窗口成为主窗口。
- 如果没有主窗口，下一个新打开的窗口可以成为主窗口。
- 主窗口 ID 是运行时内存状态，不写入持久化存储。
- 主窗口侧边栏显示 Workspace、Page、Unmanaged 区域。

### 临时窗口

- 临时窗口不展示 Workspace 列表。
- 临时窗口不能直接接管 Mooring 状态。
- 临时窗口只能：
  - 打开主窗口。
  - 发送当前 Chrome Tab 到主窗口。
  - 发送全部 Chrome Tabs 到主窗口。

### 主窗口关闭

- 清空主窗口 ID。
- 清空 Workspace / Page 与 Chrome Group / Chrome Tab 的 runtime binding。
- 保留 `Mooring Workspace` 书签目录。
- 已存在临时窗口不自动升级为主窗口。
- 下一次打开主窗口或侧边栏时，重新从 bookmark 和当前 Chrome 状态建立运行时关系。

### Chrome session restore

- Chrome 恢复出来的 Chrome Group 不自动成为 Mooring 长期数据。
- Mooring 可以在启动或主窗口关闭后的第一次扫描中清空 runtime binding，并重新匹配当前 Chrome Group。
- Mooring 不主动拆散 Chrome Group，不删除 bookmark，不关闭 Chrome Tab。

## Unmanaged 区域

Unmanaged 区域显示当前主窗口里未被 Mooring 管理的 Chrome 状态。

- 未管理 Chrome Tab 显示为 unmanaged Temp Page。
- 未管理 Chrome Group 显示为 unmanaged Chrome Group。
- Unmanaged 区域显示在 Workspace 管理区下面。
- Unmanaged 区域不写 bookmark。
- Unmanaged Chrome Group 保留 Chrome 的颜色和标题。
- Unmanaged Chrome Group 标题允许为空；Mooring 不提供兜底标题文案，以便和 Chrome 原生表现一致。
- Unmanaged Chrome Group 是 Chrome 原生分组，不是 Mooring Workspace。
- Unmanaged Chrome Group 可以在侧边栏里重命名、修改颜色和解散；修改会同步到 Chrome Group。
- Unmanaged Chrome Group 只用轻量有色边框标识，不能和 Workspace 使用同一套容器视觉。
- Mooring 不把 unmanaged Chrome Group 自动转换为 Workspace。

边界规则：

- 如果用户在 Chrome 里手动创建不匹配任何 Workspace 的 Chrome Group，它留在 Unmanaged 区。
- 如果 unmanaged Chrome Tab 被拖入 Workspace，它变成 Workspace 内 Temp Page。
- 如果 unmanaged Chrome Group 被拖入 Workspace，该 Group 内所有 Chrome Tab 都进入目标 Workspace，成为 Temp Page；原 Chrome Group 不变成 Workspace。
- 如果 unmanaged Chrome Group 不被拖入 Workspace，它始终只是 Chrome Group。

## Workspace 和 Chrome Group 管理逻辑

Workspace 是 Mooring 的长期容器；Chrome Group 是 Workspace 在主窗口里的运行时投影。

Workspace 的长期属性写在 bookmark 文件夹 title 上：

- 名称：不能为空。
- 颜色：`[blue] Work`
- 隐藏状态：`[blue:hidden] Work`
- 旧格式不带隐藏状态时，默认显示。

### Workspace 创建

- 只能在主窗口侧边栏创建 Workspace。
- 默认名称使用 `Workspace 1`、`Workspace 2` 这种短名字。
- 创建空 Workspace 只创建 bookmark 文件夹，不创建 Chrome Group。
- 只有当 Workspace 内某个 Page 被打开时，才创建并绑定 Chrome Group。
- Workspace 可以没有任何打开的 Page，此时对应 Chrome Group 可以不存在。
- Workspace 即使没有 Chrome Group，也可以切换显示/隐藏状态；状态写入 bookmark 文件夹 title。

### Workspace 打开

打开 Workspace 内 Page 时：

1. 如果 Workspace 已绑定有效 Chrome Group，把 Chrome Tab 加入该 Chrome Group。
2. 如果 Workspace 没有 Chrome Group，用该 Page 打开的 Chrome Tab 创建 Chrome Group。
3. Chrome Group 标题使用 Workspace 名称。
4. Chrome Group 颜色使用 Workspace 颜色。
5. Chrome Group collapsed 使用 Workspace 的显示/隐藏状态。

### Workspace 删除

- 删除前必须二次确认。
- 删除 Workspace bookmark 文件夹。
- 删除该 Workspace 下所有 Pinned Page bookmark。
- 清空该 Workspace 的 runtime binding。
- 已打开的 Chrome Tabs 释放到 Unmanaged 区。
- 删除 Workspace 不直接关闭 Chrome Tabs。

### Chrome Group 匹配 Workspace

当 Chrome 创建或恢复 Chrome Group 时：

- Mooring 先按颜色和名称匹配 Workspace。
- 如果匹配成功，且 Workspace 未打开，绑定该 Chrome Group。
- 如果匹配成功，且 Workspace 已经打开，把该 Chrome Group 里的 Chrome Tabs 合并进 Workspace 已绑定的 Chrome Group，然后解除原 Chrome Group。
- 如果匹配失败，作为 unmanaged Chrome Group 显示。

匹配只是运行时行为，不会创建新的 Workspace bookmark 文件夹。

### Unmanaged Chrome Group 移入 Workspace

- 用户可以把 unmanaged Chrome Group 拖到某个 Workspace。
- 该操作不会创建 Workspace bookmark 文件夹。
- Chrome Group title / color 不会写入 Workspace。
- Group 内 Chrome Tabs 批量移动到目标 Workspace 的运行时 Chrome Group。
- 这些 Chrome Tabs 在目标 Workspace 内都是 Temp Page，不自动写 bookmark。
- 如果目标 Workspace 当前没有 Chrome Group，用第一批移入的 Chrome Tab 创建 Workspace 的运行时 Chrome Group。

### Chrome Group 解散

当 Mooring 管理的 Chrome Group 被解散：

- Workspace 保留。
- Workspace 解绑该 Chrome Group。
- Pinned Page 保留 bookmark，并解绑 Chrome Tab。
- 原先打开的 Chrome Tabs 变成 unmanaged Temp Pages。
- 如果用户再次点击 Pinned Page，Mooring 会重新创建 Chrome Tab 和 Chrome Group。

当 unmanaged Chrome Group 被用户在 Mooring 侧边栏里解散：

- 该 Chrome Group 内 Chrome Tabs 变成 unmanaged 普通 Chrome Tabs。
- 不创建 Workspace，不写 bookmark，不改变 Mooring managed 区域。
- 原 Chrome Group title / color 不进入 Mooring 长期数据。

## Page 和 Chrome Tab 管理逻辑

Workspace 内 Page 分为 Pinned Page 和 Temp Page。

### Pinned Page

- 只能出现在 Workspace 内。
- 对应 workspace bookmark 文件夹下的一个 bookmark。
- 可以绑定 Chrome Tab，也可以没有 Chrome Tab。
- 关闭 Chrome Tab 后仍保留在 Workspace。
- 点击关闭态 Pinned Page 时，按 bookmark URL 创建 Chrome Tab。
- 如果 Workspace 没有 Chrome Group，用新 Chrome Tab 创建 Chrome Group。
- 如果 Workspace 已有 Chrome Group，把新 Chrome Tab 加入该 Chrome Group。
- Pinned Page 标题来自 bookmark title。
- Pinned Page URL 来自 bookmark URL。
- Pinned Page 可以编辑 bookmark title。

### Temp Page

- 一定绑定一个 Chrome Tab。
- 不对应 bookmark。
- 关闭 Chrome Tab 后消失。
- 可以通过星标固定为 Pinned Page。
- 固定后创建 bookmark，并继续绑定当前 Chrome Tab。

### Dirty Pinned Page

当 Pinned Page 绑定的 Chrome Tab 当前 URL 与 bookmark URL 不一致时：

- Pinned Page 进入 dirty 状态。
- UI 显示 dirty 标识。
- 标题显示 `bookmark title · current Chrome Tab title`。
- 不自动更新 bookmark URL。
- 不自动取消固定。
- 关闭该 Chrome Tab 后，Pinned Page 仍按 bookmark URL 恢复。
- dirty 小蓝点是恢复入口，点击后把当前 Chrome Tab 导回该 Pinned Page 的 bookmark URL。

### 取消固定

- 取消固定必须二次确认。
- 删除 Pinned Page 对应 bookmark。
- 如果 Chrome Tab 当前仍打开，它变成 Temp Page。
- 取消固定不关闭 Chrome Tab。

## 排序规则

Mooring managed 区域的排序与 Chrome 标签栏排序完全脱钩。

排序分为两套：

- Mooring managed 排序：由 Mooring 自己维护，是侧边栏的真实顺序。
- Chrome unmanaged 排序：由 Chrome 当前 Window / Group / Tab 顺序决定。

Chrome Tab index 和 Chrome Group index 不作为 Mooring managed 的排序来源。

### Workspace 排序

- Workspace 长期顺序来自 `Mooring Workspace` 根目录下的书签文件夹顺序。
- 拖动 Workspace 时，同步移动书签文件夹。
- 不同步移动 Chrome Group。
- Chrome Group 只承载 Workspace 的打开状态，不表达 Workspace 顺序。

### Workspace 与 Unmanaged 的位置

- Mooring 管理的 Workspace 区域排在 Unmanaged 区域前面。
- Mooring managed 区域在侧边栏里排在 Unmanaged 区域前面。
- 不要求 Mooring managed 的 Chrome Group 位于 Chrome 标签栏前部。
- 如果用户在 Chrome 里移动 managed Chrome Tab 或 Chrome Group，不改变 Mooring managed 侧边栏顺序。
- 如果 unmanaged Chrome Tab 或 Chrome Group 被拖进 managed 区域，只有用户在 Mooring 里显式加入 Workspace 时才变成 managed。

### Pinned Page 排序

- Pinned Page 和 Temp Page 可以在 Workspace 内自由混排。
- Workspace 内 Page 顺序来自 Mooring runtime 顺序。
- Pinned Page 长期相对顺序来自 bookmark 顺序。
- 关闭态 Pinned Page 也可以拖动排序。
- 移动 Pinned Page 会更新 Workspace runtime 顺序，并同步 Pinned Page 彼此之间的 bookmark 顺序。
- 如果 Pinned Page 没有绑定 Chrome Tab，只移动 bookmark。
- Pinned Page 可以拖到另一个 Workspace。
- Pinned Page 只能在 Workspace 内或 Workspace 之间拖动，不能拖到 unmanaged。
- Pinned Page 跨 Workspace 拖动时，移动对应 bookmark 到目标 Workspace 文件夹。
- 跨 Workspace 后，它成为目标 Workspace 的 Pinned Page，长期身份仍来自同一个 bookmark。
- 如果该 Pinned Page 当前绑定 Chrome Tab，只确保 Chrome Tab 位于目标 Workspace 对应 Chrome Group，不同步 Chrome Tab index。
- 如果目标 Workspace 没有 Chrome Group，则用该 Chrome Tab 创建目标 Workspace 的 Chrome Group；如果 Pinned Page 是关闭态，则只移动 bookmark，不创建 Chrome Group。

### Temp Page 排序

- Temp Page 可以和 Pinned Page 混排。
- Temp Page 顺序来自 Mooring runtime 顺序。
- Temp Page 可以拖到 Workspace 或 unmanaged。
- Temp Page 如需进入 Pinned 区，必须通过星标固定。
- Temp Page 移动只调整 Mooring runtime 顺序，不写 bookmark，不同步 Chrome Tab index。
- Chrome 重启、主窗口关闭或 service worker 重启后，Workspace runtime 顺序可以从 bookmark 顺序和当前 Chrome Group 内 Chrome Tab 顺序重新初始化。

### Unmanaged 排序

- Unmanaged Chrome Tab 顺序来自 Chrome Tab index。
- Unmanaged Chrome Group 顺序来自 Chrome 当前顺序。
- Unmanaged 区普通 Chrome Tab 和 Chrome Group 可以互相拖动排序。
- 在 Unmanaged 区拖动普通 Chrome Tab 时，同步 Chrome Tab index。
- 在 Unmanaged 区拖动 Chrome Group 时，同步 Chrome Group index。
- Unmanaged Chrome Group 内的 Page 可以拖动排序，并同步对应 Chrome Tab 在该 Chrome Group 内的顺序。
- Unmanaged 区不写 bookmark，也不写 Mooring runtime managed 顺序。

### 恢复位置

点击关闭态 Pinned Page 时：

1. 按 bookmark URL 创建 Chrome Tab。
2. 如果 Workspace 没有 Chrome Group，用新 Chrome Tab 创建 Chrome Group。
3. 如果 Workspace 已有 Chrome Group，把新 Chrome Tab 加入该 Chrome Group。
4. 不按 bookmark 顺序计算 Chrome Tab index；Chrome Tab 可以放在目标 Chrome Group 末尾。

## 三层实现边界

### Chrome 层

负责读取和操作 Chrome Window / Chrome Group / Chrome Tab：

- `chrome.windows`
- `chrome.tabGroups`
- `chrome.tabs`

Chrome 层 ID 都是运行时 ID，不能长期保存。

### Runtime 层

负责维护当前主窗口内的绑定关系：

- `workspaceId <-> chromeGroupId`
- `pageId/bookmarkId <-> chromeTabId`
- unmanaged Chrome Group / Chrome Tab 列表

Runtime 层可以用 `chrome.storage.session` 做会话级缓存：

- 缓存内容包括 Workspace 与 Chrome Group 绑定、Pinned Page 与 Chrome Tab 绑定、Workspace Page 运行时顺序。
- 缓存只解决 service worker 休眠后再次唤醒时的上下文恢复。
- 读取缓存后必须验证 Chrome Group / Chrome Tab 是否仍然存在。
- 主窗口关闭、Chrome 重启或绑定失效时可以清空并重建。
- 不使用 `chrome.storage.local` 保存 Runtime Binding。

### Bookmark 层

负责 Mooring 的长期结构：

- `Mooring Workspace` 根目录。
- Workspace bookmark 文件夹。
- Pinned Page bookmark。
- Workspace 顺序。
- Pinned Page 顺序。

Bookmark 层是长期状态来源。

## 不做的事

- 不把 Mooring Page 叫 Tab。
- 不把 Chrome Tab ID 当长期身份。
- 不把 Chrome Group ID 当长期身份。
- 不把 Temp Page 写入 bookmark。
- 不自动把 dirty Page 当前 URL 写回 bookmark。
- 不让临时窗口接管 Mooring Workspace。
- 不把 AI 做成长期聊天上下文；AI 只能生成待确认的 Mooring 操作计划。
