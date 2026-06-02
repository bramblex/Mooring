import { WorkspaceModel } from "./workspace.model";

export type WindowRole = "primary" | "temporary";

export type WindowContext = {
  currentWindowId?: number;
  primaryWindowId?: number;
  role: WindowRole;
  hasPrimaryWindow: boolean;
};

export class WindowModel {
  readonly id: number;
  role: WindowRole;

  // 只有主窗口才会有工作区
  workspaces: WorkspaceModel[] = [];

  constructor(id: number, role: WindowRole) {
    this.id = id;
    this.role = role;
  }
}
