const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mascotAPI", {
    getConfig: async () => ipcRenderer.invoke("mascot:get-config"),
    getCursorPoint: async () => ipcRenderer.invoke("mascot:get-cursor-point"),
    startWindowDrag: (payload) =>
        ipcRenderer.send("mascot:window-drag-start", payload),
    moveWindowDrag: (payload) =>
        ipcRenderer.send("mascot:window-drag-move", payload),
    endWindowDrag: () => ipcRenderer.send("mascot:window-drag-end"),
});
