const path = require("node:path");
const {
    app,
    BrowserWindow,
    ipcMain,
    screen,
    Menu,
    dialog,
} = require("electron");

const packageJson = require("../package.json");
const { createAppState } = require("./core/app-state");
const { createMainWindow } = require("./core/window-manager");
const {
    registerIpcHandlers,
    attachDragCleanupForWindow,
} = require("./core/ipc-handlers");

const appDirectory = path.resolve(path.join(__dirname, ".."));
const preloadPath = path.join(appDirectory, "src", "preload.js");
const indexPath = path.join(appDirectory, "index.html");

const appState = createAppState({
    appDirectory,
    dialog,
    packageJson,
});

const dragStateByWebContents = new Map();

function createWindow() {
    const win = createMainWindow({
        BrowserWindow,
        Menu,
        app,
        appState,
        preloadPath,
        indexPath,
    });

    attachDragCleanupForWindow(win, dragStateByWebContents);

    return win;
}

app.whenReady().then(() => {
    registerIpcHandlers({
        ipcMain,
        screen,
        BrowserWindow,
        appState,
        dragStateByWebContents,
    });

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
