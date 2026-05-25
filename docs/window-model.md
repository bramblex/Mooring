# Window 模型

Window 模型定义 Harbor 在多个 Chrome 窗口之间的工作边界。

## 目标

- Harbor 只在一个主窗口里提供完整 Workspace / Page 功能。
- 其他窗口保持临时窗口身份，不自动变成 Workspace 主基地。
- 主窗口 ID 只保存在运行时内存里，不写入 `chrome.storage.local`。
- 主窗口关闭后，Workspace / Pinned Page 长期数据仍然由书签树保留。

## 核心概念

### 主窗口

主窗口是唯一启用完整 Workspace / Page 管理能力的 Chrome 窗口。

- 扩展刚安装或启动初始化时，如果没有主窗口，当前窗口成为主窗口。
- 初始化完成后，如果没有主窗口，下一个新打开的窗口成为主窗口。
- 主窗口 ID 是运行时状态 `primaryWindowId`。
- 主窗口侧边栏显示 Workspace / Page 完整管理 UI。
- UI 不提供 `Set as primary`。

Chrome 本身没有主窗口概念，主窗口是 Harbor 自己的产品状态。

### 临时窗口

只要当前窗口的 `windowId` 不等于 `primaryWindowId`，它就是临时窗口。

临时窗口侧边栏只提供：

- `Open main window`
- `Send current Chrome Tab to main window`
- `Send all Chrome Tabs to main window`

临时窗口不展示 Workspace 列表，不管理 Page 状态。

## 窗口关系

- 已经存在的临时窗口不会因为主窗口关闭而自动变成主窗口。
- 如果场上没有主窗口，后续新打开的窗口可以成为主窗口。
- 临时窗口可以把 Chrome Tab 发送到主窗口。
- 临时窗口不能直接接管 Workspace。

## 主窗口关闭

主窗口关闭时：

- Harbor 清空内存里的 `primaryWindowId`。
- Harbor 清空 Workspace / Chrome Group / Page / Chrome Tab 的运行时绑定。
- `Harbor Workspace` 书签目录保留不变。
- 已存在的其他窗口仍然是临时窗口。
- Chrome session restore 出来的 Chrome Group 不作为 Harbor 长期状态。
- Harbor 不因为重建 runtime binding 主动拆散 Chrome Group。

下一次打开主窗口或侧边栏时：

1. 重新确认当前窗口身份。
2. 重新读取 `Harbor Workspace` 书签目录。
3. 重新建立 Workspace 与 Chrome Group、Page 与 Chrome Tab 的运行时关系。

## 临时窗口操作

### Open main window

如果主窗口存在：

```ts
await chrome.windows.update(primaryWindowId, { focused: true });
```

如果主窗口不存在：

1. 新建 Chrome 窗口。
2. 把新窗口 ID 设为 `primaryWindowId`。
3. 从书签树恢复 Workspace / Pinned Page 结构。

### Send current Chrome Tab to main window

1. 获取临时窗口当前激活 Chrome Tab。
2. 移动到主窗口。
3. 聚焦主窗口。
4. 后续可按 active Workspace 规则加入对应 Workspace，成为 Temp Page。

### Send all Chrome Tabs to main window

逻辑同发送当前 Chrome Tab，但移动临时窗口内全部可移动 Chrome Tab。

## 不做的事

- 不把主窗口 ID 写入持久化存储。
- 不让临时窗口自动升级成主窗口。
- 不在多个窗口同时启用完整 Workspace / Page 管理。
- 不依赖 Chrome 自己的窗口恢复作为 Harbor 的长期状态来源。
