/**
 * Register IPC handlers for renderer <-> main communication.
 *
 * Responsibilities:
 * - Provide renderer startup config.
 * - Open model picker and apply selected model.
 * - Return global cursor position relative to window.
 * - Resize mascot window with max-width/max-height constraints.
 * - Handle frameless window drag (start/move/end).
 */

function registerIpcHandlers({
    ipcMain,
    screen,
    BrowserWindow,
    appState,
    dragStateByWebContents,
}) {
    if (!ipcMain || !screen || !BrowserWindow || !appState) {
        throw new Error(
            "[ipc] Missing required dependencies for IPC registration.",
        );
    }

    const dragState = dragStateByWebContents || new Map();

    function clampWindowSize(payload = {}) {
        const windowConfig = appState.appConfig?.window || {};
        const maxWidth = Math.max(100, Number(windowConfig.maxWidth) || 800);
        const maxHeight = Math.max(100, Number(windowConfig.maxHeight) || 1000);

        const requestedWidth = Number(payload.width);
        const requestedHeight = Number(payload.height);

        if (!Number.isFinite(requestedWidth) || !Number.isFinite(requestedHeight)) {
            return null;
        }

        return {
            width: Math.max(100, Math.min(maxWidth, Math.round(requestedWidth))),
            height: Math.max(100, Math.min(maxHeight, Math.round(requestedHeight))),
        };
    }

    // Avoid duplicate handle registration if this function is called more than once.
    if (typeof ipcMain.removeHandler === "function") {
        ipcMain.removeHandler("mascot:get-config");
        ipcMain.removeHandler("mascot:open-model-picker");
        ipcMain.removeHandler("mascot:get-cursor-point");
        ipcMain.removeHandler("mascot:resize-window");
    }

    // Avoid duplicate event listeners if re-registered.
    ipcMain.removeAllListeners("mascot:window-drag-start");
    ipcMain.removeAllListeners("mascot:window-drag-move");
    ipcMain.removeAllListeners("mascot:window-drag-end");

    ipcMain.handle("mascot:get-config", () => {
        return appState.getRendererConfig();
    });

    ipcMain.handle("mascot:open-model-picker", async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) {
            return { ok: false, error: "window-destroyed" };
        }

        return appState.openModelPickerAndApply(win, {
            persist: true,
            emit: true,
        });
    });

    ipcMain.handle("mascot:get-cursor-point", (event) => {
        const cursor = screen.getCursorScreenPoint();
        const win = BrowserWindow.fromWebContents(event.sender);

        if (!win || win.isDestroyed()) {
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

    ipcMain.handle("mascot:resize-window", (event, payload = {}) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) {
            return { ok: false, error: "window-destroyed" };
        }

        const size = clampWindowSize(payload);
        if (!size) {
            return { ok: false, error: "invalid-size" };
        }

        const [x, y] = win.getPosition();
        win.setBounds({
            x,
            y,
            width: size.width,
            height: size.height,
        });

        return { ok: true, width: size.width, height: size.height };
    });

    ipcMain.on("mascot:window-drag-start", (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) return;

        const cursor = screen.getCursorScreenPoint();
        const bounds = win.getBounds();

        dragState.set(event.sender.id, {
            windowId: win.id,
            startCursorX: cursor.x,
            startCursorY: cursor.y,
            startWindowX: bounds.x,
            startWindowY: bounds.y,
            width: bounds.width,
            height: bounds.height,
        });
    });

    ipcMain.on("mascot:window-drag-move", (event) => {
        const state = dragState.get(event.sender.id);
        if (!state) return;

        const win = BrowserWindow.fromId(state.windowId);
        if (!win || win.isDestroyed()) {
            dragState.delete(event.sender.id);
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
        dragState.delete(event.sender.id);
    });

    return {
        dragStateByWebContents: dragState,
    };
}

/**
 * Attach cleanup hooks so drag state is removed when window/webContents is gone.
 */
function attachDragCleanupForWindow(win, dragStateByWebContents) {
    if (!win || !dragStateByWebContents) return;

    const senderId = win.webContents.id;
    const cleanup = () => dragStateByWebContents.delete(senderId);

    win.on("closed", cleanup);
    win.webContents.on("destroyed", cleanup);
}

module.exports = {
    registerIpcHandlers,
    attachDragCleanupForWindow,
};
