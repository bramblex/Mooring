# AI Action 执行计划

本文档定义 Mooring 后续接入 AI 时的产品边界和执行流程。AI 能力是轻量辅助功能，不改变 Mooring 的核心模型：Workspace / Page / Bookmark 仍然是产品主体，AI 只生成可审查的操作计划。

## 产品定位

AI 不是聊天窗口，也不是自动接管浏览器的代理。

AI 在 Mooring 里是一次性的 `Prompt -> Action Plan` 工具：

1. 用户点击侧边栏左下角 AI 按钮。
2. Mooring 打开一个轻量对话框。
3. 用户只输入一句临时 prompt。
4. Mooring 把当前结构化状态和这句 prompt 发给模型。
5. 模型只返回 Mooring 支持的结构化操作指令。
6. Mooring 展示操作预览。
7. 用户确认后，Mooring 执行这些操作。

对话框关闭后，这句 prompt 丢弃；不保存聊天记录，不维护上下文记忆。

## UI 入口

- AI 入口放在侧边栏左下角，和右下角的新建 Page / 新建 Workspace 按钮区分。
- 按钮使用轻量 icon 样式，不抢 Workspace 列表的注意力。
- 点击按钮打开轻量弹窗，而不是进入完整聊天界面。

弹窗第一版只包含：

- 一个多行输入框。
- 一个生成按钮。
- 一个取消按钮。

输入框只表达本次意图，例如：

```text
帮我把当前这些页面按项目整理一下，并把标题改短。
```

## 无上下文规则

- AI 不读取历史 prompt。
- AI 不保存用户和模型之间的对话。
- AI 每次只接收当前一次 prompt。
- AI 每次只接收当前 Mooring 结构化状态。
- AI 不根据上一次执行结果自动继续生成下一步。
- 用户可以手动再次点击 AI 按钮重新输入 prompt。

## AI 输入

Mooring 发送给 AI 的输入应该是结构化 JSON，而不是 DOM、截图或原始 Chrome 对象。

输入包含：

- 当前主窗口 ID。
- Workspace 列表。
- 每个 Workspace 的名称、颜色、折叠状态。
- 每个 Workspace 内 Page 的 ID、标题、URL、Pinned / Temp 状态、dirty 状态。
- Unmanaged 区域的 Chrome Tab 和 Chrome Group 摘要。
- 用户本次输入的一句 prompt。
- 当前允许 AI 使用的 action schema。

输入不包含：

- Chrome Tab ID 以外的敏感浏览器内部对象。
- 页面正文内容。
- 页面截图。
- 历史 prompt。
- 用户 API Key。
- Mooring 配置之外的浏览器数据。

## AI 输出

AI 只能输出一个 `AiAction[]`。Mooring 不接受自然语言作为执行依据。

推荐结构：

```ts
type AiActionPlan = {
  summary: string;
  actions: AiAction[];
};
```

`summary` 只用于展示给用户阅读，不参与执行。

## 第一版允许的指令

第一版只开放低风险、可预览、可撤销成本较低的指令。

```ts
type AiAction =
  | RenameWorkspaceAction
  | CreateWorkspaceAction
  | MovePageAction
  | RenamePageAction;

type RenameWorkspaceAction = {
  type: "rename_workspace";
  workspaceId: string;
  name: string;
};

type CreateWorkspaceAction = {
  type: "create_workspace";
  name: string;
  color?: WorkspaceColor;
};

type MovePageAction = {
  type: "move_page";
  pageId: string;
  toWorkspaceId: string;
  index?: number;
};

type RenamePageAction = {
  type: "rename_page";
  pageId: string;
  title: string;
};
```

### 指令规则

- `rename_workspace` 不能把 Workspace 名称改为空。
- `create_workspace` 默认只创建 bookmark 文件夹，不创建 Chrome Group。
- `move_page` 必须指向已存在 Workspace，除非后续版本明确支持 AI 创建后再引用。
- `rename_page` 只作用于 Pinned Page 的 bookmark title；Temp Page 标题来自 Chrome Tab，不允许直接改名。
- AI 不能直接操作 Chrome API。
- AI 不能直接写 bookmark。
- AI 不能绕过 Mooring 现有模型方法。

## 暂不开放的高风险指令

第一版不开放：

- 删除 Workspace。
- 删除 Pinned Page bookmark。
- 取消固定 Page。
- 关闭 Chrome Tab。
- 打开任意外部 URL。
- 修改 AI 配置。
- 修改 unmanaged Chrome Group 名称或颜色。
- 解散 Chrome Group。
- 批量关闭页面。

这些操作都可能带来不可逆或高惊扰结果，后续即使开放，也必须单独确认。

## 执行流程

### 生成阶段

1. 用户输入 prompt。
2. Side panel 请求 service worker 获取最新 `WorkspaceState`。
3. Side panel 或 service worker 组装 AI 输入。
4. 调用用户配置的模型 API。
5. 得到 `AiActionPlan`。
6. 对结果做 schema 校验。

### 校验阶段

Mooring 必须在执行前做本地校验：

- action type 是否在允许列表中。
- action 引用的 Workspace / Page 是否存在。
- action 是否符合 Page 类型规则。
- 名称是否为空。
- index 是否在合理范围内。
- action 数量是否超过限制。

校验失败时，不执行任何 action，并在弹窗里展示错误。

### 预览阶段

AI 返回后，弹窗切换到预览态。

预览使用 Mooring 自己生成的文案，不直接信任 AI summary。

示例：

```text
AI wants to:
- Rename workspace "Vue" to "Frontend"
- Rename page "GitHub - vuejs/core" to "Vue Core"
- Move page "Vite docs" to "Frontend"
```

用户可以：

- Apply：执行全部 action。
- Cancel：丢弃本次 plan。

第一版不做单条 action 勾选，避免 UI 变复杂。

### 执行阶段

- 用户确认后才执行。
- Mooring 按 action 顺序调用现有领域模型。
- 执行后刷新侧边栏状态。
- 如果某条 action 失败，停止后续执行，并提示已经完成和失败的位置。
- AI 不在执行阶段再次参与。

## 配置规则

AI 功能默认可以不可用。

用户需要自行配置：

- Provider。
- API Key。
- Model。

配置缺失时：

- 点击 AI 按钮进入配置提示。
- 不发送任何请求。
- 不影响 Mooring 原有功能。

API Key 不进入 AI prompt，也不展示在日志里。

## 安全边界

- AI 只能生成 action plan。
- 执行权在 Mooring 本地代码。
- 最终确认权在用户。
- 所有 action 必须通过本地 schema 校验。
- 所有 action 必须走现有模型边界。
- AI 不能新增未定义 action type。
- AI 不能生成 JavaScript 代码让 Mooring 执行。
- AI 不能读取页面正文或用户浏览内容，除非后续版本显式增加权限和说明。

## 后续可扩展方向

后续可以考虑增加：

- 保存常用 prompt 为 AI Action。
- 为 AI Action 设置允许的指令范围。
- 支持 `pin_page`，但需要确认。
- 支持 `unpin_page`，但需要强确认。
- 支持 `close_page`，但需要强确认。
- 支持仅整理当前 Workspace。
- 支持仅整理 unmanaged 区域。

这些能力都不改变第一版原则：AI 生成计划，用户确认，Mooring 执行。
