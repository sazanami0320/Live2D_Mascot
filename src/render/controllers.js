import { clamp } from "./utils.js";

export function setParam(coreModel, id, value, weight = 1) {
    if (!coreModel || typeof id !== "string") return;

    try {
        if (typeof coreModel.setParameterValueById === "function") {
            coreModel.setParameterValueById(id, value, weight);
            return;
        }

        if (typeof coreModel.addParameterValueById === "function") {
            coreModel.addParameterValueById(id, value * weight);
        }
    } catch {
        // Ignore unsupported parameter IDs.
    }
}

export function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-no-drag="true"]')) return true;

    return Boolean(
        target.closest(
            "button, a, input, textarea, select, option, label, summary, [role='button']",
        ),
    );
}

export function createModelController({
    app,
    getConfig,
    mascotAPI,
    onModelLoaded,
    onModelCleared,
} = {}) {
    let model = null;
    let loadRequestId = 0;
    let breathingBaseY = 0;

    function getCurrentModel() {
        return model;
    }

    function getBreathingBaseY() {
        return breathingBaseY;
    }

    function placeModel() {
        if (!model) return;

        const config = getConfig?.() || {};
        const anchorX = Number(config.model?.anchorX ?? 0.5);
        const anchorY = Number(config.model?.anchorY ?? 1);

        if (model.anchor && typeof model.anchor.set === "function") {
            model.anchor.set(anchorX, anchorY);
        }

        model.x = window.innerWidth * anchorX;
        model.y = window.innerHeight * anchorY;
        breathingBaseY = model.y;
    }

    async function autoFitWindowToModel() {
        if (!model) return;

        const config = getConfig?.() || {};
        const baseScale = Math.max(0.0001, Number(config.model?.scale ?? 0.28));

        model.scale.set(1);

        const bounds =
            typeof model.getLocalBounds === "function"
                ? model.getLocalBounds()
                : { width: 400, height: 600 };

        const naturalWidth = Math.max(1, Math.ceil(bounds.width || 1));
        const naturalHeight = Math.max(1, Math.ceil(bounds.height || 1));

        const baseWidth = naturalWidth * baseScale;
        const baseHeight = naturalHeight * baseScale;

        const maxWidth = Math.max(100, Number(config.window?.maxWidth ?? 800));
        const maxHeight = Math.max(100, Number(config.window?.maxHeight ?? 1000));

        const fitRatio = Math.min(1, maxWidth / baseWidth, maxHeight / baseHeight);
        const finalScale = baseScale * fitRatio;

        const targetWidth = Math.max(100, Math.round(naturalWidth * finalScale));
        const targetHeight = Math.max(100, Math.round(naturalHeight * finalScale));

        model.scale.set(finalScale);

        if (mascotAPI?.resizeWindow) {
            try {
                await mascotAPI.resizeWindow({
                    width: targetWidth,
                    height: targetHeight,
                });
            } catch {
                // Keep rendering even if resize IPC fails.
            }
        }

        placeModel();
    }

    async function fetchEmotionConfig(modelUrl) {
        try {
            const baseUrl = modelUrl.substring(0, modelUrl.lastIndexOf("/"));
            const emotionsUrl = `${baseUrl}/emotions.json`;
            const response = await fetch(emotionsUrl);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async function loadModelByUrl(url) {
        if (!url || typeof url !== "string") {
            throw new Error("Invalid model URL.");
        }

        const Live2DModel = window.PIXI?.live2d?.Live2DModel;
        if (!Live2DModel) {
            throw new Error("Live2D runtime is not ready.");
        }

        const requestId = ++loadRequestId;
        const [nextModel, emotionConfig] = await Promise.all([
            Live2DModel.from(url),
            fetchEmotionConfig(url),
        ]);

        if (requestId !== loadRequestId) {
            try {
                nextModel.destroy?.();
            } catch {}
            return;
        }

        if (model) {
            try {
                app?.stage?.removeChild(model);
                model.destroy?.();
            } catch {}
        }

        model = nextModel;
        app?.stage?.removeChildren?.();
        app?.stage?.addChild?.(model);

        await autoFitWindowToModel();

        if (typeof onModelLoaded === "function") {
            onModelLoaded(model, emotionConfig);
        }
    }

    function clearModel() {
        if (!model) return;

        try {
            app?.stage?.removeChild?.(model);
            model.destroy?.();
        } catch {}

        model = null;
        breathingBaseY = 0;

        if (typeof onModelCleared === "function") {
            onModelCleared();
        }
    }

    function destroy() {
        clearModel();
    }

    return {
        getCurrentModel,
        getBreathingBaseY,
        placeModel,
        autoFitWindowToModel,
        loadModelByUrl,
        clearModel,
        destroy,
    };
}

export function createCursorTracker({
    mascotAPI,
    getConfig,
    getModel,
} = {}) {
    let targetX = window.innerWidth * 0.5;
    let targetY = window.innerHeight * 0.5;
    let smoothX = targetX;
    let smoothY = targetY;

    let timer = null;
    let inFlight = false;

    function toNormalized(worldX, worldY) {
        return {
            x: clamp((worldX / window.innerWidth) * 2 - 1, -1, 1),
            y: clamp((worldY / window.innerHeight) * 2 - 1, -1, 1),
        };
    }

    async function pollGlobalCursor() {
        if (inFlight) return;
        if (!mascotAPI?.getCursorPoint) return;

        inFlight = true;
        try {
            const point = await mascotAPI.getCursorPoint();
            if (!point) return;

            const nextX = Number(point.windowX);
            const nextY = Number(point.windowY);

            if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
                targetX = nextX;
                targetY = nextY;
            }
        } catch {
            // Keep last known values.
        } finally {
            inFlight = false;
        }
    }

    function start() {
        const config = getConfig?.() || {};
        const eyeCfg = config.behavior?.eyeFollowMouse || {};

        const pollingRate = clamp(Number(eyeCfg.pollingRate ?? 30), 1, 240);
        const intervalMs = Math.round(1000 / pollingRate);

        stop();
        timer = window.setInterval(pollGlobalCursor, intervalMs);
        pollGlobalCursor();
    }

    function update() {
        const model = getModel?.();
        if (!model) return;

        const config = getConfig?.() || {};
        const eyeCfg = config.behavior?.eyeFollowMouse || {};

        const strength = Number(eyeCfg.strength ?? 1);
        const smoothing = clamp(Number(eyeCfg.smoothing ?? 0.15), 0.01, 1);

        smoothX += (targetX - smoothX) * smoothing;
        smoothY += (targetY - smoothY) * smoothing;

        if (typeof model.focus === "function") {
            const centeredX =
                (smoothX - window.innerWidth * 0.5) * strength +
                window.innerWidth * 0.5;
            const centeredY =
                (smoothY - window.innerHeight * 0.5) * strength +
                window.innerHeight * 0.5;

            model.focus(centeredX, centeredY);
            return;
        }

        const coreModel = model.internalModel?.coreModel;
        const n = toNormalized(smoothX, smoothY);
        const x = clamp(n.x * strength, -1, 1);
        const y = clamp(n.y * strength, -1, 1);

        setParam(coreModel, "ParamEyeBallX", x);
        setParam(coreModel, "ParamEyeBallY", y);
        setParam(coreModel, "ParamAngleX", x * 25);
        setParam(coreModel, "ParamAngleY", -y * 25);
        setParam(coreModel, "ParamBodyAngleX", x * 8);
    }

    function stop() {
        if (timer !== null) {
            window.clearInterval(timer);
            timer = null;
        }
    }

    function destroy() {
        stop();
    }

    return {
        start,
        update,
        stop,
        destroy,
    };
}

export function createWindowDragController({ mascotAPI } = {}) {
    if (
        !mascotAPI?.startWindowDrag ||
        !mascotAPI?.moveWindowDrag ||
        !mascotAPI?.endWindowDrag
    ) {
        return {
            destroy() {},
        };
    }

    let dragging = false;
    let pointerId = null;

    function onPointerDown(event) {
        if (event.button !== 0) return;
        if (isInteractiveTarget(event.target)) return;

        dragging = true;
        pointerId = event.pointerId ?? null;

        if (pointerId !== null && event.target?.setPointerCapture) {
            try {
                event.target.setPointerCapture(pointerId);
            } catch {}
        }

        mascotAPI.startWindowDrag();
    }

    function onPointerMove() {
        if (!dragging) return;
        mascotAPI.moveWindowDrag();
    }

    function onPointerUpOrCancel(event) {
        if (!dragging) return;

        dragging = false;
        mascotAPI.endWindowDrag();

        if (pointerId !== null && event?.target?.releasePointerCapture) {
            try {
                event.target.releasePointerCapture(pointerId);
            } catch {}
        }

        pointerId = null;
    }

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUpOrCancel, true);
    window.addEventListener("pointercancel", onPointerUpOrCancel, true);
    window.addEventListener("blur", onPointerUpOrCancel, true);

    return {
        destroy() {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerUpOrCancel, true);
            window.removeEventListener(
                "pointercancel",
                onPointerUpOrCancel,
                true,
            );
            window.removeEventListener("blur", onPointerUpOrCancel, true);
        },
    };
}
