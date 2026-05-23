# Chrome Side Panel Tabs

Vue 3 + Vite + TypeScript Chrome extension for managing tabs and tab groups from a side panel.

详见 [窗口、Workspace 与标签页模型](docs/workspace-model.md) 和 [Service Worker 与 Side Panel 通信模型](docs/service-sidepanel-communication.md)。

## Scripts

```sh
npm install
npm run build
```

## Load locally

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `/Users/brambles/Workspace/chrome-workspace/dist`.
6. Click the extension icon or press `Command+Shift+Y` to open the side panel.

The Vue template is compiled during `npm run build`, so the Chrome extension runtime does not need `unsafe-eval`.
