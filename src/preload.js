const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mascotAPI", {
    getConfig: async () => ipcRenderer.invoke("mascot:get-config"),
    getCursorPoint: async () => ipcRenderer.invoke("mascot:get-cursor-point"),
    openModelPicker: async () => ipcRenderer.invoke("mascot:open-model-picker"),

    startWindowDrag: () => ipcRenderer.send("mascot:window-drag-start"),
    moveWindowDrag: () => ipcRenderer.send("mascot:window-drag-move"),
    endWindowDrag: () => ipcRenderer.send("mascot:window-drag-end"),

    resizeWindow: async (payload) =>
        ipcRenderer.invoke("mascot:resize-window", payload),

    onSwitchModel: (callback) => {
        if (typeof callback !== "function") {
            return () => {};
        }

        const listener = (_event, data) => {
            callback(data);
        };

        ipcRenderer.on("mascot:switch-model", listener);

        return () => {
            ipcRenderer.removeListener("mascot:switch-model", listener);
        };
    },

    sendEmotionsLoaded: (payload) =>
        ipcRenderer.send("mascot:emotions-loaded", payload),

    onSetEmotion: (callback) => {
        if (typeof callback !== "function") {
            return () => {};
        }

        const listener = (_event, data) => {
            callback(data);
        };

        ipcRenderer.on("mascot:set-emotion", listener);

        return () => {
            ipcRenderer.removeListener("mascot:set-emotion", listener);
        };
    },
});
