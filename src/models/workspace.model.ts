import { uuid } from "../utils/uuid";
import { TabModel } from "./tab.model";

export class WorkspaceModel {
    // 工作区的唯一标识符
    readonly id: string = uuid();
    readonly name: string = "新建工作区";
    readonly tabs: TabModel[] = [];

    // 运行时属性
    readonly groupId: number | null = null;

    constructor() {
    }
}
