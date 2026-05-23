import { WindowModel, type WindowContext, type WindowRole } from "./window.model";
import { WorkspaceModel, type TabGroupColor } from "./workspace.model";

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
        type: "OPEN_WORKSPACE_TAB";
        workspaceId: string;
        tabId: string;
        windowId?: number;
    }
    | {
        type: "CLOSE_WORKSPACE_TAB";
        tabId: number;
    }
    | {
        type: "PIN_TAB";
        workspaceId: string;
        tabId: number;
    }
    | {
        type: "UNPIN_TAB";
        tabId?: number;
        bookmarkId?: string;
    }
    | {
        type: "MOVE_WORKSPACE_TAB";
        tabId: number;
        workspaceId: string | null;
        index: number;
        windowId?: number;
    }
    | {
        type: "MOVE_WORKSPACE";
        sourceWorkspaceId: string;
        targetWorkspaceId: string;
    };

export class AppModel {

    windows: WindowModel[] = [];
    workspace = new WorkspaceModel();

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

    start() {
        this.initialize();

        chrome.runtime.onInstalled.addListener(async () => {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            await this.initialize();
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
            this.handleMessage(message).then(sendResponse);
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
                if (!message.windowId) return { workspaces: [], ungroupedTabs: [] };
                return this.workspace.getState(message.windowId);
            case "CREATE_WORKSPACE":
                if (!message.windowId) return { ok: false };
                await this.workspace.createWorkspace(message.windowId);
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
            case "OPEN_WORKSPACE_TAB":
                if (!message.windowId) return { ok: false };
                await this.workspace.openWorkspaceTab(message.workspaceId, message.tabId, message.windowId);
                return { ok: true };
            case "CLOSE_WORKSPACE_TAB":
                await this.workspace.closeWorkspaceTab(message.tabId);
                return { ok: true };
            case "PIN_TAB":
                await this.workspace.pinTab(message.workspaceId, message.tabId);
                return { ok: true };
            case "UNPIN_TAB":
                await this.workspace.unpinTab(message.tabId, message.bookmarkId);
                return { ok: true };
            case "MOVE_WORKSPACE_TAB":
                if (!message.windowId) return { ok: false };
                await this.workspace.moveTabToWorkspace(
                    message.tabId,
                    message.workspaceId,
                    message.index,
                    message.windowId,
                );
                return { ok: true };
            case "MOVE_WORKSPACE":
                await this.workspace.moveWorkspace(message.sourceWorkspaceId, message.targetWorkspaceId);
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
        this.windows = this.windows.filter((window) => window.id !== id);
    }

    private nextWindowRole(): WindowRole {
        return this.mainWindow ? "temporary" : "primary";
    }
}
