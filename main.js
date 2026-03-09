const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CONFIG_PATH = path.join(__dirname, "config.json");

const DEFAULT_CONFIG = {
    window: {
        width: 400,
        height: 600,
        alwaysOnTop: true,
        resizable: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
    },
    model: {
        path: "./model/kasane_teto_utau/重音テトUTAU衣装live2d.model3.json",
        scale: 0.28,
        x: 200,
        y: 560,
        anchorX: 0.5,
        anchorY: 1,
    },
    behavior: {
        eyeFollowMouse: {
            enabled: true,
            strength: 1,
            pollingRate: 30,
        },
        breathing: {
            enabled: true,
            amplitude: 0.5,
            speed: 1,
        },
    },
};

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
    const output = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        if (isPlainObject(value) && isPlainObject(base[key])) {
            output[key] = deepMerge(base[key], value);
        } else {
            output[key] = value;
        }
    }
    return output;
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
        const raw = fs.readFileSync(CONFIG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return deepMerge(DEFAULT_CONFIG, parsed);
    } catch (error) {
        console.error(
            "[config] Failed to load config.json, using defaults:",
            error,
        );
        return DEFAULT_CONFIG;
    }
}

const appConfig = loadConfig();

function buildRendererConfig(config) {
    const modelPath = config?.model?.path;
    const absoluteModelPath = path.resolve(__dirname, modelPath || "");
    const modelUrl = pathToFileURL(absoluteModelPath).href;

    return {
        ...config,
        model: {
            ...(config.model || {}),
            path: modelPath,
            url: modelUrl,
        },
    };
}

const rendererConfig = buildRendererConfig(appConfig);

/**
 * Keyed by sender webContents.id.
 * Stores a fixed drag baseline so moving the window never changes its size.
 */
const dragStateByWebContents = new Map();

function createWindow() {
    const windowConfig = appConfig.window || {};

    const win = new BrowserWindow({
        width: Number(windowConfig.width) || 400,
        height: Number(windowConfig.height) || 600,
        alwaysOnTop: windowConfig.alwaysOnTop !== false,
        resizable: windowConfig.resizable === true,
        frame: windowConfig.frame === true,
        transparent: windowConfig.transparent !== false,
        backgroundColor: windowConfig.backgroundColor || "#00000000",
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.loadFile("index.html");

    const senderId = win.webContents.id;
    const cleanupDragState = () => dragStateByWebContents.delete(senderId);
    win.on("closed", cleanupDragState);
    win.webContents.on("destroyed", cleanupDragState);
}

ipcMain.handle("mascot:get-config", () => rendererConfig);

ipcMain.handle("mascot:get-cursor-point", (event) => {
    const cursor = screen.getCursorScreenPoint();
    const win = BrowserWindow.fromWebContents(event.sender);

    if (!win) {
        return {
            screenX: cursor.x,
            screenY: cursor.y,
            windowX: cursor.x,
            windowY: cursor.y,
            windowWidth: 0,
            windowHeight: 0,
        };
    }

    const bounds = win.getBounds();

    return {
        screenX: cursor.x,
        screenY: cursor.y,
        windowX: cursor.x - bounds.x,
        windowY: cursor.y - bounds.y,
        windowWidth: bounds.width,
        windowHeight: bounds.height,
    };
});

/**
 * Start drag using global cursor from main process.
 * This avoids renderer event coordinate inconsistencies across platforms.
 */
ipcMain.on("mascot:window-drag-start", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();

    dragStateByWebContents.set(event.sender.id, {
        windowId: win.id,
        startCursorX: cursor.x,
        startCursorY: cursor.y,
        startWindowX: bounds.x,
        startWindowY: bounds.y,
        width: bounds.width,
        height: bounds.height,
    });
});

/**
 * Move drag by polling global cursor in main process and
 * applying bounds with locked width/height to prevent accidental stretching.
 */
ipcMain.on("mascot:window-drag-move", (event) => {
    const state = dragStateByWebContents.get(event.sender.id);
    if (!state) return;

    const win = BrowserWindow.fromId(state.windowId);
    if (!win || win.isDestroyed()) {
        dragStateByWebContents.delete(event.sender.id);
        return;
    }

    const cursor = screen.getCursorScreenPoint();

    const nextX = Math.round(
        state.startWindowX + (cursor.x - state.startCursorX),
    );
    const nextY = Math.round(
        state.startWindowY + (cursor.y - state.startCursorY),
    );

    win.setBounds({
        x: nextX,
        y: nextY,
        width: state.width,
        height: state.height,
    });
});

ipcMain.on("mascot:window-drag-end", (event) => {
    dragStateByWebContents.delete(event.sender.id);
});

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
