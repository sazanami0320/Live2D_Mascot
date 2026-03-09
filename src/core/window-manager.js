const path = require("node:path");

/**
 * Build submenu entries for recent models.
 * @param {object} params
 * @param {import("electron").BrowserWindow} params.win
 * @param {object} params.appState
 * @returns {Array<object>}
 */
function buildRecentModelsSubmenu({ win, appState }) {
    const recentModels = appState.getRecentModels();

    if (!recentModels.length) {
        return [{ label: "No recent models", enabled: false }];
    }

    const items = recentModels.map((modelPath) => ({
        label: path.basename(modelPath),
        toolTip: modelPath,
        click: async () => {
            await appState.applyModelSelection(win, modelPath, {
                persist: true,
                emit: true,
            });
        },
    }));

    items.push({ type: "separator" });
    items.push({
        label: "Clear Recent",
        click: () => {
            appState.clearRecentModels();
        },
    });

    return items;
}

/**
 * Build right-click context menu.
 * @param {object} params
 * @param {import("electron").BrowserWindow} params.win
 * @param {import("electron").Menu} params.Menu
 * @param {import("electron").app} params.app
 * @param {object} params.appState
 * @returns {import("electron").Menu}
 */
function buildContextMenu({ win, Menu, app, appState }) {
    return Menu.buildFromTemplate([
        {
            label: "Switch Model…",
            click: async () => {
                await appState.openModelPickerAndApply(win, {
                    persist: true,
                    emit: true,
                });
            },
        },
        {
            label: "Recent Models",
            submenu: buildRecentModelsSubmenu({ win, appState }),
        },
        { type: "separator" },
        {
            label: "Reload",
            click: () => {
                if (!win.isDestroyed()) {
                    win.webContents.reload();
                }
            },
        },
        {
            label: "Quit",
            click: () => app.quit(),
        },
    ]);
}

/**
 * Create main mascot window and attach context menu behavior.
 * @param {object} params
 * @param {typeof import("electron").BrowserWindow} params.BrowserWindow
 * @param {import("electron").Menu} params.Menu
 * @param {import("electron").app} params.app
 * @param {object} params.appState
 * @param {string} [params.preloadPath]
 * @param {string} [params.indexPath]
 * @returns {import("electron").BrowserWindow}
 */
function createMainWindow({
    BrowserWindow,
    Menu,
    app,
    appState,
    preloadPath,
    indexPath,
}) {
    const windowConfig = appState.appConfig?.window || {};

    const width = Number(windowConfig.width) || 400;
    const height = Number(windowConfig.height) || 600;

    const resolvedPreloadPath =
        preloadPath || path.join(__dirname, "..", "preload.js");
    const resolvedIndexPath = indexPath || path.join(__dirname, "..", "index.html");

    const win = new BrowserWindow({
        width,
        height,
        alwaysOnTop: windowConfig.alwaysOnTop !== false,
        resizable: windowConfig.resizable === true,
        frame: windowConfig.frame === true,
        transparent: windowConfig.transparent !== false,
        backgroundColor: windowConfig.backgroundColor || "#00000000",
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            preload: resolvedPreloadPath,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.loadFile(resolvedIndexPath);

    win.webContents.on("context-menu", () => {
        const menu = buildContextMenu({ win, Menu, app, appState });
        menu.popup({ window: win });
    });

    return win;
}

module.exports = {
    createMainWindow,
    buildContextMenu,
    buildRecentModelsSubmenu,
};
