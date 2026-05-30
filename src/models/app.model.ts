import { WindowModel, type WindowContext, type WindowRole } from "./window.model";
import { UnmanagedModel } from "./unmanaged.model";
import { WorkspaceModel, type TabGroupColor } from "./workspace.model";
import { WorkspaceRuntimeStore } from "./workspace.runtime";

type AppMessage =
    | {
        type: "GET_WINDOW_CONTEXT";
        windowId?: number;
    }
    | {
        type: "OPEN_MAIN_WINDOW";
    }
    | {
        type: "SEND_CURRENT_TAB_TO_MAIN_WINDOW";
        windowId?: number;
    }
    | {
        type: "SEND_ALL_TABS_TO_MAIN_WINDOW";
        windowId?: number;
    }
    | {
        type: "GET_WORKSPACE_STATE";
        windowId?: number;
    }
    | {
        type: "CREATE_WORKSPACE";
        windowId?: number;
    }
    | {
        type: "CREATE_PAGE";
        windowId?: number;
    }
    | {
        type: "RENAME_WORKSPACE";
        workspaceId: string;
        name: string;
    }
    | {
        type: "UPDATE_WORKSPACE_COLOR";
        workspaceId: string;
        color: TabGroupColor;
    }
    | {
        type: "TOGGLE_WORKSPACE";
        workspaceId: string;
    }
    | {
        type: "DELETE_WORKSPACE";
        workspaceId: string;
    }
    | {
        type: "CLOSE_WORKSPACE_PAGES";
        workspaceId: string;
    }
    | {
        type: "OPEN_WORKSPACE_PAGE";
        workspaceId: string;
        pageId: string;
        chromeTabId?: number;
        windowId?: number;
    }
    | {
        type: "CLOSE_WORKSPACE_PAGE";
        chromeTabId: number;
    }
    | {
        type: "RESTORE_PINNED_PAGE";
        bookmarkId: string;
        chromeTabId?: number;
    }
    | {
        type: "PIN_PAGE";
        workspaceId: string;
        chromeTabId: number;
    }
    | {
        type: "UNPIN_PAGE";
        chromeTabId?: number;
        bookmarkId?: string;
    }
    | {
        type: "UPDATE_PINNED_PAGE_TITLE";
        bookmarkId: string;
        title: string;
    }
    | {
        type: "MOVE_WORKSPACE_PAGE";
        pageId: string;
        workspaceId: string | null;
        index: number;
        windowId?: number;
    }
    | {
        type: "MOVE_WORKSPACE";
        sourceWorkspaceId: string;
        index: number;
    }
    | {
        type: "RENAME_UNMANAGED_GROUP";
        groupId: number;
        title: string;
    }
    | {
        type: "UNGROUP_UNMANAGED_GROUP";
        groupId: number;
    }
    | {
        type: "UPDATE_UNMANAGED_GROUP_COLOR";
        groupId: number;
        color: TabGroupColor;
    }
    | {
        type: "MOVE_UNMANAGED_ITEM";
        itemType: "page" | "group";
        itemId: string | number;
        index: number;
        windowId?: number;
    }
    | {
        type: "MOVE_UNMANAGED_PAGE_TO_GROUP";
        pageId: string;
        groupId: number;
        index: number;
    }
    | {
        type: "MOVE_UNMANAGED_GROUP_TO_WORKSPACE";
        groupId: number;
        workspaceId: string;
        index: number;
    };

export class AppModel {

    windows: WindowModel[] = [];
    // docs/product-logic.md: AppModel 只做 service worker 侧协调，
    // Workspace / Page / Unmanaged 的具体业务分别交给领域模型。
    runtime = new WorkspaceRuntimeStore();
    workspace = new WorkspaceModel(this.runtime);
    unmanaged = new UnmanagedModel(this.runtime);

    constructor() {
    }

    get mainWindow() {
        return this.windows.find((window) => window.role === "primary") || null;
    }

    createWindow(id?: number, role?: WindowRole) {
        if (!id) return;

        const existingWindow = this.findWindow(id);
        if (existingWindow) return existingWindow;

        const window = new WindowModel(id, role || this.nextWindowRole());
        this.windows.push(window);
        return window;
    }

    async initialize() {
        await this.ensureMainWindowIsValid();
        if (this.mainWindow) return;

        // docs/window-model.md: 首次安装或初始化时，如果没有主窗口，
        // 当前窗口成为主窗口；主窗口 ID 只保存在运行时内存。
        const currentWindow = await chrome.windows.getCurrent();
        this.createWindow(currentWindow.id, "primary");
    }

    async getWindowContext(windowId?: number): Promise<WindowContext> {
        await this.ensureMainWindowIsValid();

        if (!windowId) {
            return {
                currentWindowId: windowId,
                primaryWindowId: this.mainWindow?.id,
                role: "temporary",
                hasPrimaryWindow: Boolean(this.mainWindow),
            };
        }

        const window = this.ensureWindow(windowId);

        return {
            currentWindowId: windowId,
            primaryWindowId: this.mainWindow?.id,
            role: window?.role || "temporary",
            hasPrimaryWindow: Boolean(this.mainWindow),
        };
    }

    async openMainWindow() {
        const mainWindow = await this.ensureMainWindow();
        if (!mainWindow) {
            return;
        }

        return chrome.windows.update(mainWindow.id, { focused: true });
    }

    async sendCurrentTabToMainWindow(windowId?: number) {
        if (!windowId) {
            return;
        }

        const [activeTab] = await chrome.tabs.query({
            active: true,
            windowId,
        });

        if (!activeTab?.id) {
            return;
        }

        await this.sendTabsToMainWindow([activeTab.id]);
    }

    async sendAllTabsToMainWindow(windowId?: number) {
        if (!windowId) {
            return;
        }

        const tabs = await chrome.tabs.query({ windowId });
        const tabIds = tabs.flatMap((tab) => (tab.id ? [tab.id] : []));

        await this.sendTabsToMainWindow(tabIds);
    }

    async sendTabsToMainWindow(tabIds: number[]) {
        if (tabIds.length === 0) {
            return;
        }

        const mainWindow = await this.ensureMainWindow();
        if (!mainWindow) {
            return;
        }

        await chrome.tabs.move(tabIds as [number, ...number[]], {
            windowId: mainWindow.id,
            index: -1,
        });

        await chrome.windows.update(mainWindow.id, { focused: true });
    }

    async getWorkspaceState(windowId: number) {
        // docs/service-sidepanel-communication.md: WorkspaceState 是 side panel
        // 渲染快照，由 managed Workspace 和 unmanaged Chrome 状态组合而成。
        // docs/workspace-model.md: 生成 Workspace 快照时会先按名称和颜色恢复
        // Workspace 与 Chrome Group 的 runtime binding；unmanaged 区必须在
        // binding 同步完成后再计算，否则首次打开会把已绑定 Group 显示成 unmanaged。
        const workspaces = await this.workspace.getWorkspaces(windowId);
        const unmanaged = await this.unmanaged.getState(windowId);

        return {
            workspaces,
            unmanagedPages: unmanaged.unmanagedPages,
            unmanagedGroups: unmanaged.unmanagedGroups,
        };
    }

    start() {
        void this.initialize();

        chrome.runtime.onInstalled.addListener(async (details) => {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            if (details.reason === "install") {
                await this.workspace.ensureStarterWorkspace();
            }
            await this.initialize();
        });

        chrome.runtime.onStartup.addListener(() => {
            this.workspace.markRuntimeBindingsRebuildNeeded();
        });

        chrome.action.onClicked.addListener(async (tab) => {
            if (!tab.windowId) return;
            await chrome.sidePanel.open({ windowId: tab.windowId });
        });

        chrome.windows.onCreated.addListener((window) => {
            this.createWindow(window.id);
        });

        chrome.windows.onRemoved.addListener((windowId) => {
            this.removeWindow(windowId);
        });

        chrome.runtime.onMessage.addListener((message: AppMessage, _sender, sendResponse) => {
            this.handleMessage(message)
                .then(sendResponse)
                .catch((error) => {
                    sendResponse({
                        ok: false,
                        error: error instanceof Error ? error.message : "Unexpected service worker error.",
                    });
                });
            return true;
        });
    }

    private async handleMessage(message: AppMessage) {
        switch (message.type) {
            case "GET_WINDOW_CONTEXT":
                return this.getWindowContext(message.windowId);
            case "OPEN_MAIN_WINDOW":
                await this.openMainWindow();
                return { ok: true };
            case "SEND_CURRENT_TAB_TO_MAIN_WINDOW":
                await this.sendCurrentTabToMainWindow(message.windowId);
                return { ok: true };
            case "SEND_ALL_TABS_TO_MAIN_WINDOW":
                await this.sendAllTabsToMainWindow(message.windowId);
                return { ok: true };
            case "GET_WORKSPACE_STATE":
                if (!message.windowId) return { workspaces: [], unmanagedPages: [], unmanagedGroups: [] };
                return this.getWorkspaceState(message.windowId);
            case "CREATE_WORKSPACE":
                if (!message.windowId) return { ok: false };
                await this.workspace.createWorkspace(message.windowId);
                return { ok: true };
            case "CREATE_PAGE":
                if (!message.windowId) return { ok: false };
                await this.unmanaged.createPage(message.windowId);
                return { ok: true };
            case "RENAME_WORKSPACE":
                await this.workspace.renameWorkspace(message.workspaceId, message.name);
                return { ok: true };
            case "UPDATE_WORKSPACE_COLOR":
                await this.workspace.updateWorkspaceColor(message.workspaceId, message.color);
                return { ok: true };
            case "TOGGLE_WORKSPACE":
                await this.workspace.toggleWorkspace(message.workspaceId);
                return { ok: true };
            case "DELETE_WORKSPACE":
                await this.workspace.deleteWorkspace(message.workspaceId);
                return { ok: true };
            case "CLOSE_WORKSPACE_PAGES":
                await this.workspace.closeWorkspacePages(message.workspaceId);
                return { ok: true };
            case "OPEN_WORKSPACE_PAGE":
                if (!message.windowId) return { ok: false };
                await this.workspace.pages.openWorkspacePage(
                    message.workspaceId,
                    message.pageId,
                    message.windowId,
                    message.chromeTabId,
                );
                return { ok: true };
            case "CLOSE_WORKSPACE_PAGE":
                await this.workspace.pages.closeWorkspacePage(message.chromeTabId);
                return { ok: true };
            case "RESTORE_PINNED_PAGE":
                await this.workspace.pages.restorePinnedPage(message.bookmarkId, message.chromeTabId);
                return { ok: true };
            case "PIN_PAGE":
                await this.workspace.pages.pinPage(message.workspaceId, message.chromeTabId);
                return { ok: true };
            case "UNPIN_PAGE":
                await this.workspace.pages.unpinPage(message.chromeTabId, message.bookmarkId);
                return { ok: true };
            case "UPDATE_PINNED_PAGE_TITLE":
                await this.workspace.pages.updatePinnedPageTitle(message.bookmarkId, message.title);
                return { ok: true };
            case "MOVE_WORKSPACE_PAGE":
                if (!message.windowId) return { ok: false };
                await this.workspace.pages.movePageToWorkspace(
                    message.pageId,
                    message.workspaceId,
                    message.index,
                    message.windowId,
                );
                return { ok: true };
            case "MOVE_WORKSPACE":
                await this.workspace.moveWorkspace(message.sourceWorkspaceId, message.index);
                return { ok: true };
            case "RENAME_UNMANAGED_GROUP":
                await this.unmanaged.renameGroup(message.groupId, message.title);
                return { ok: true };
            case "UNGROUP_UNMANAGED_GROUP":
                await this.unmanaged.ungroupGroup(message.groupId);
                return { ok: true };
            case "UPDATE_UNMANAGED_GROUP_COLOR":
                await this.unmanaged.updateGroupColor(message.groupId, message.color);
                return { ok: true };
            case "MOVE_UNMANAGED_ITEM":
                if (!message.windowId) return { ok: false };
                await this.unmanaged.moveItem(
                    message.itemType,
                    message.itemId,
                    message.index,
                    message.windowId,
                );
                return { ok: true };
            case "MOVE_UNMANAGED_PAGE_TO_GROUP":
                await this.unmanaged.movePageToGroup(message.pageId, message.groupId, message.index);
                return { ok: true };
            case "MOVE_UNMANAGED_GROUP_TO_WORKSPACE":
                await this.workspace.moveChromeGroupToWorkspace(
                    message.groupId,
                    message.workspaceId,
                    message.index,
                );
                return { ok: true };
            default:
                return { ok: false };
        }
    }

    private async ensureMainWindowIsValid() {
        const mainWindow = this.mainWindow;
        if (!mainWindow) {
            return;
        }

        try {
            await chrome.windows.get(mainWindow.id);
        } catch {
            this.removeWindow(mainWindow.id);
        }
    }

    private async ensureMainWindow() {
        await this.ensureMainWindowIsValid();

        if (this.mainWindow) return this.mainWindow;

        const chromeWindow = await chrome.windows.create({ focused: true });
        return this.createWindow(chromeWindow?.id, "primary");
    }

    private ensureWindow(id: number) {
        return this.findWindow(id) || this.createWindow(id, "temporary");
    }

    private findWindow(id: number) {
        return this.windows.find((window) => window.id === id);
    }

    private removeWindow(id: number) {
        const removedWindow = this.findWindow(id);
        this.windows = this.windows.filter((window) => window.id !== id);

        if (removedWindow?.role === "primary") {
            // docs/window-model.md: 主窗口关闭后清空 Workspace / Page 与
            // Chrome Group / Chrome Tab 的 runtime binding，Bookmark 保留。
            this.workspace.clearRuntimeBindings();
        }
    }

    private nextWindowRole(): WindowRole {
        return this.mainWindow ? "temporary" : "primary";
    }
}
