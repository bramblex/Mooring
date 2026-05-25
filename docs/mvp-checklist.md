# Harbor MVP Checklist

本文档记录 Harbor 进入 MVP 可日常使用前必须闭环的事项。产品规则源头仍然是 [产品逻辑文档](./产品逻辑文档.md)。

## 必须完成

### Bookmark 外部变更同步

- Harbor 的长期数据来自 Chrome Bookmark。
- Side panel 打开期间，应监听 `chrome.bookmarks` 事件并刷新 Workspace / Page 状态。
- 用户在 Chrome 书签管理器里重命名、移动、删除 Harbor Workspace 或 Pinned Page 后，Harbor 不应显示明显过期状态。
- 状态：已实现。

### 删除 Workspace 不关闭用户页面

- 删除 Workspace 会删除对应 bookmark folder。
- Workspace 下 Pinned Page bookmark 随 folder 删除。
- 如果 Workspace 当前绑定 Chrome Group，已经打开的 Chrome Tabs 释放到 Unmanaged 区。
- 删除 Workspace 不直接关闭 Chrome Tabs，避免数据损失。
- 状态：已实现。

### Unmanaged Chrome Group 纳入 Harbor

- Unmanaged Chrome Group 可以显式转成 Harbor Workspace。
- 转换时创建 Workspace bookmark folder。
- Workspace 名称和颜色使用 Chrome Group title / color。
- 原 Chrome Group 绑定到新 Workspace。
- Group 内 Chrome Tabs 成为该 Workspace 的 Temp Page，不自动写 bookmark。
- 状态：已实现。

## MVP 后可继续完善

- Dirty Pinned Page 增加“更新 Bookmark 到当前页面”操作。
- 增加轻量 toast/status，用于提示失败操作，例如不可 bookmark 的 `chrome://` 页面。
- Temp Page runtime 顺序在 service worker 重启后允许从 Chrome Group 当前顺序恢复。
- 清理 `docs/service-sidepanel-communication.md` 中过时的 storage source-of-truth 叙述。
