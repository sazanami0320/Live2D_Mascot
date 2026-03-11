const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RECENT_MODELS_LIMIT = 10;

const DEFAULT_CONFIG = {
    window: {
        width: 400,
        height: 600,
        maxWidth: 800,
        maxHeight: 1000,
        alwaysOnTop: true,
        resizable: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
    },
    modelPath: null,
    recentModels: [],
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

function safeReadJson(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        console.error(`[config] Failed to read ${filePath}:`, error);
        return null;
    }
}

function safeWriteJson(filePath, data) {
    try {
        fs.writeFileSync(
            filePath,
            `${JSON.stringify(data, null, 4)}\n`,
            "utf8",
        );
        return true;
    } catch (error) {
        console.error(`[config] Failed to write ${filePath}:`, error);
        return false;
    }
}

function normalizeRecentModels(list) {
    const result = [];
    const seen = new Set();

    for (const item of list || []) {
        if (typeof item !== "string") continue;
        const value = item.trim();
        if (!value || seen.has(value)) continue;

        seen.add(value);
        result.push(value);

        if (result.length >= RECENT_MODELS_LIMIT) break;
    }

    return result;
}

function isModel3JsonPath(filePath) {
    return (
        typeof filePath === "string" &&
        filePath.toLowerCase().endsWith(".model3.json")
    );
}

function createAppState(options = {}) {
    const appDirectory = options.appDirectory || path.resolve(__dirname, "..");
    const dialog = options.dialog;
    const packageJson =
        options.packageJson ||
        safeReadJson(path.join(appDirectory, "package.json")) ||
        {};

    const projectName =
        packageJson.build?.productName || packageJson.name || "DesktopMascot";

    const bundledConfigPath = path.join(appDirectory, "config.json");
    const externalConfigDir =
        process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
    const externalConfigPath = path.join(externalConfigDir, "config.json");

    const bundled = safeReadJson(bundledConfigPath);
    const external = safeReadJson(externalConfigPath);

    let appConfig = deepMerge(DEFAULT_CONFIG, bundled || {});
    appConfig = deepMerge(appConfig, external || {});

    if (!Array.isArray(appConfig.recentModels)) {
        appConfig.recentModels = [];
    }

    const runtimeState = {
        currentModelPath:
            typeof appConfig.modelPath === "string" &&
            appConfig.modelPath.trim() &&
            isModel3JsonPath(appConfig.modelPath)
                ? appConfig.modelPath
                : null,
        recentModels: normalizeRecentModels(appConfig.recentModels),
        availableEmotions: [],
        currentEmotion: null,
    };

    function resolveModelAbsolutePath(modelPath) {
        if (!modelPath || typeof modelPath !== "string") return null;
        if (path.isAbsolute(modelPath)) return modelPath;

        const fromExecutable = path.resolve(externalConfigDir, modelPath);
        if (fs.existsSync(fromExecutable)) return fromExecutable;

        return path.resolve(appDirectory, modelPath);
    }

    function toModelUrl(modelPath) {
        const abs = resolveModelAbsolutePath(modelPath);
        return abs ? pathToFileURL(abs).href : null;
    }

    function persistRuntimeModelState() {
        const externalConfig = safeReadJson(externalConfigPath) || {};

        externalConfig.modelPath = runtimeState.currentModelPath || null;
        externalConfig.recentModels = normalizeRecentModels(
            runtimeState.recentModels,
        );

        safeWriteJson(externalConfigPath, externalConfig);
    }

    function addRecentModel(modelPath) {
        runtimeState.recentModels = normalizeRecentModels([
            modelPath,
            ...runtimeState.recentModels,
        ]);
    }

    function getRendererConfig() {
        const startupCandidate = runtimeState.currentModelPath;
        const startupAbsolute = resolveModelAbsolutePath(startupCandidate);

        const hasUsableStartupModel =
            typeof startupCandidate === "string" &&
            startupCandidate.trim() &&
            isModel3JsonPath(startupCandidate) &&
            !!startupAbsolute &&
            fs.existsSync(startupAbsolute);

        const startupModelPath = hasUsableStartupModel ? startupAbsolute : null;
        const startupModelUrl = startupModelPath
            ? pathToFileURL(startupModelPath).href
            : null;

        if (!hasUsableStartupModel) {
            runtimeState.currentModelPath = null;
        }

        return {
            ...appConfig,
            projectName,
            modelPath: startupModelPath,
            recentModels: normalizeRecentModels(runtimeState.recentModels),
            model: {
                path: startupModelPath,
                url: startupModelUrl,
                scale: 0.28,
                anchorX: 0.5,
                anchorY: 1,
            },
        };
    }

    async function openModelPicker(win) {
        if (!dialog) {
            return { ok: false, error: "dialog-unavailable" };
        }

        const result = await dialog.showOpenDialog(win, {
            title: "Select Live2D Model",
            properties: ["openFile"],
            filters: [
                { name: "Live2D Model", extensions: ["model3.json", "json"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });

        if (result.canceled || !result.filePaths?.length) {
            return { ok: false, canceled: true };
        }

        return { ok: true, filePath: result.filePaths[0] };
    }

    async function applyModelSelection(win, selectedPath, options = {}) {
        const persist = options.persist !== false;
        const emit = options.emit !== false;

        if (!isModel3JsonPath(selectedPath)) {
            if (dialog && win && !win.isDestroyed()) {
                await dialog.showMessageBox(win, {
                    type: "warning",
                    title: "Unsupported file",
                    message: "Please select a .model3.json file.",
                });
            }

            return { ok: false, error: "unsupported-extension" };
        }

        const absolutePath = path.resolve(selectedPath);

        if (!fs.existsSync(absolutePath)) {
            if (dialog && win && !win.isDestroyed()) {
                await dialog.showMessageBox(win, {
                    type: "error",
                    title: "File not found",
                    message: "Selected model file does not exist.",
                });
            }

            return { ok: false, error: "not-found" };
        }

        const modelPath = absolutePath;
        const modelUrl = pathToFileURL(absolutePath).href;

        runtimeState.currentModelPath = modelPath;
        addRecentModel(modelPath);

        if (persist) {
            persistRuntimeModelState();
        }

        if (emit && win && !win.isDestroyed()) {
            win.webContents.send("mascot:switch-model", {
                path: modelPath,
                url: modelUrl,
            });
        }

        return { ok: true, path: modelPath, url: modelUrl };
    }

    async function openModelPickerAndApply(win, options = {}) {
        const pick = await openModelPicker(win);
        if (!pick.ok) return pick;

        return applyModelSelection(win, pick.filePath, options);
    }

    function clearRecentModels() {
        runtimeState.recentModels = [];
        persistRuntimeModelState();
    }

    function getRecentModels() {
        return normalizeRecentModels(runtimeState.recentModels);
    }

    function setAvailableEmotions(emotions, currentEmotion) {
        runtimeState.availableEmotions = Array.isArray(emotions) ? emotions : [];
        runtimeState.currentEmotion = currentEmotion || null;
    }

    function getAvailableEmotions() {
        return runtimeState.availableEmotions;
    }

    function getCurrentEmotion() {
        return runtimeState.currentEmotion;
    }

    function setCurrentEmotion(key) {
        runtimeState.currentEmotion = key || null;
    }

    return {
        projectName,
        appConfig,
        runtimeState,

        getExternalConfigPath: () => externalConfigPath,
        getRendererConfig,
        getRecentModels,
        clearRecentModels,

        setAvailableEmotions,
        getAvailableEmotions,
        getCurrentEmotion,
        setCurrentEmotion,

        resolveModelAbsolutePath,
        toModelUrl,
        isModel3JsonPath,

        addRecentModel,
        persistRuntimeModelState,

        openModelPicker,
        applyModelSelection,
        openModelPickerAndApply,
    };
}

module.exports = {
    DEFAULT_CONFIG,
    RECENT_MODELS_LIMIT,
    createAppState,
    deepMerge,
    isModel3JsonPath,
    normalizeRecentModels,
};
