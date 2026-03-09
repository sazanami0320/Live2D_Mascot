(() => {
    // Prevent duplicate initialization if renderer.js is injected/evaluated more than once.
    if (window.__MASCOT_RENDERER_INITIALIZED__) {
        console.warn("[renderer] Initialization skipped: already initialized.");
        return;
    }
    window.__MASCOT_RENDERER_INITIALIZED__ = true;

    const DEFAULTS = {
        model: {
            url: "",
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
                smoothing: 0.15,
                pollingRate: 30,
            },
            breathing: {
                enabled: true,
                amplitude: 0.5,
                speed: 1,
            },
        },
    };

    let app = null;
    let model = null;

    function deepMerge(base, override) {
        const out = { ...base };
        for (const [k, v] of Object.entries(override || {})) {
            const isObject = v && typeof v === "object" && !Array.isArray(v);
            const baseIsObject =
                out[k] && typeof out[k] === "object" && !Array.isArray(out[k]);

            out[k] = isObject && baseIsObject ? deepMerge(out[k], v) : v;
        }
        return out;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function showError(message) {
        const el = document.createElement("div");
        el.textContent = message;
        el.style.position = "fixed";
        el.style.left = "12px";
        el.style.bottom = "12px";
        el.style.right = "12px";
        el.style.padding = "10px 12px";
        el.style.borderRadius = "8px";
        el.style.background = "rgba(0,0,0,0.65)";
        el.style.color = "#fff";
        el.style.fontFamily = "sans-serif";
        el.style.fontSize = "13px";
        el.style.zIndex = "99999";
        document.body.appendChild(el);
    }

    function setParam(coreModel, id, value, weight = 1) {
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
            // Unknown parameter ID or unsupported runtime call. Safe to ignore.
        }
    }

    function getCanvas() {
        let canvas = document.getElementById("stage");
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.id = "stage";
            canvas.style.position = "fixed";
            canvas.style.inset = "0";
            canvas.style.width = "100vw";
            canvas.style.height = "100vh";
            canvas.style.background = "transparent";
            document.body.appendChild(canvas);
        }

        // Ensure previous frame artifacts are not kept by stale renderers.
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        return canvas;
    }

    async function createPixiApp(canvas) {
        const PIXI = window.PIXI;
        return new PIXI.Application({
            view: canvas,
            autoStart: true,
            antialias: true,
            autoDensity: true,
            transparent: true,
            resizeTo: window,
            clearBeforeRender: true,
            preserveDrawingBuffer: false,
        });
    }

    function setupMouseTracking(config) {
        const eyeCfg = config.behavior.eyeFollowMouse || {};
        const strength = Number(eyeCfg.strength ?? 1);
        const smoothing = clamp(Number(eyeCfg.smoothing ?? 0.15), 0.01, 1);
        const pollingRate = clamp(Number(eyeCfg.pollingRate ?? 30), 1, 240);
        const pollingIntervalMs = Math.round(1000 / pollingRate);

        // Live2DModel.focus() expects world-space coordinates, not normalized [-1, 1].
        let targetWorldX = window.innerWidth * 0.5;
        let targetWorldY = window.innerHeight * 0.5;
        let smoothedWorldX = targetWorldX;
        let smoothedWorldY = targetWorldY;

        let pollingTimer = null;
        let pollInFlight = false;

        function toNormalized(worldX, worldY) {
            const nx = (worldX / window.innerWidth) * 2 - 1;
            const ny = (worldY / window.innerHeight) * 2 - 1;
            return {
                x: clamp(nx, -1, 1),
                y: clamp(ny, -1, 1),
            };
        }

        async function pollGlobalCursor() {
            if (pollInFlight) return;
            if (
                !window.mascotAPI ||
                typeof window.mascotAPI.getCursorPoint !== "function"
            ) {
                return;
            }

            pollInFlight = true;
            try {
                const point = await window.mascotAPI.getCursorPoint();
                if (!point) return;

                const nextX = Number(point.windowX);
                const nextY = Number(point.windowY);

                if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
                    targetWorldX = nextX;
                    targetWorldY = nextY;
                }
            } catch {
                // Ignore transient IPC/polling errors and keep last known target.
            } finally {
                pollInFlight = false;
            }
        }

        // Poll global cursor position so eye-tracking keeps working
        // even when the pointer is outside the mascot window.
        pollingTimer = window.setInterval(pollGlobalCursor, pollingIntervalMs);
        pollGlobalCursor();

        return {
            update() {
                smoothedWorldX += (targetWorldX - smoothedWorldX) * smoothing;
                smoothedWorldY += (targetWorldY - smoothedWorldY) * smoothing;

                if (typeof model.focus === "function") {
                    const centeredX =
                        (smoothedWorldX - window.innerWidth * 0.5) * strength +
                        window.innerWidth * 0.5;
                    const centeredY =
                        (smoothedWorldY - window.innerHeight * 0.5) * strength +
                        window.innerHeight * 0.5;

                    model.focus(centeredX, centeredY);
                } else {
                    const coreModel =
                        model.internalModel && model.internalModel.coreModel;
                    const normalized = toNormalized(
                        smoothedWorldX,
                        smoothedWorldY,
                    );
                    const x = clamp(normalized.x * strength, -1, 1);
                    const y = clamp(normalized.y * strength, -1, 1);

                    setParam(coreModel, "ParamEyeBallX", x);
                    setParam(coreModel, "ParamEyeBallY", y);
                    setParam(coreModel, "ParamAngleX", x * 25);
                    setParam(coreModel, "ParamAngleY", -y * 25);
                    setParam(coreModel, "ParamBodyAngleX", x * 8);
                }
            },
            dispose() {
                if (pollingTimer !== null) {
                    window.clearInterval(pollingTimer);
                    pollingTimer = null;
                }
            },
        };
    }

    function setupWindowDragging() {
        if (
            !window.mascotAPI ||
            typeof window.mascotAPI.startWindowDrag !== "function" ||
            typeof window.mascotAPI.moveWindowDrag !== "function" ||
            typeof window.mascotAPI.endWindowDrag !== "function"
        ) {
            return { dispose() {} };
        }

        let dragging = false;
        let dragPointerId = null;

        function startDrag(event) {
            // Left button only.
            if (event.button !== 0) return;

            dragging = true;
            dragPointerId = event.pointerId ?? null;

            if (dragPointerId !== null && event.target?.setPointerCapture) {
                try {
                    event.target.setPointerCapture(dragPointerId);
                } catch {
                    // Ignore pointer-capture failures.
                }
            }

            window.mascotAPI.startWindowDrag();
        }

        function moveDrag(event) {
            if (!dragging) return;
            window.mascotAPI.moveWindowDrag();
        }

        function endDrag(event) {
            if (!dragging) return;

            dragging = false;
            window.mascotAPI.endWindowDrag();

            if (
                dragPointerId !== null &&
                event?.target?.releasePointerCapture
            ) {
                try {
                    event.target.releasePointerCapture(dragPointerId);
                } catch {
                    // Ignore pointer-capture release failures.
                }
            }

            dragPointerId = null;
        }

        // Use capture phase to ensure dragging works regardless of child elements.
        window.addEventListener("pointerdown", startDrag, true);
        window.addEventListener("pointermove", moveDrag, true);
        window.addEventListener("pointerup", endDrag, true);
        window.addEventListener("pointercancel", endDrag, true);
        window.addEventListener("blur", endDrag, true);

        return {
            dispose() {
                window.removeEventListener("pointerdown", startDrag, true);
                window.removeEventListener("pointermove", moveDrag, true);
                window.removeEventListener("pointerup", endDrag, true);
                window.removeEventListener("pointercancel", endDrag, true);
                window.removeEventListener("blur", endDrag, true);
            },
        };
    }

    async function main() {
        const PIXI = window.PIXI;
        const Live2DModel = PIXI && PIXI.live2d && PIXI.live2d.Live2DModel;

        if (!PIXI || !Live2DModel) {
            throw new Error(
                "Live2D runtime is not ready. Ensure PixiJS and pixi-live2d-display are loaded before renderer.js.",
            );
        }

        const rawConfig =
            (window.mascotAPI && (await window.mascotAPI.getConfig())) || {};
        const config = deepMerge(DEFAULTS, rawConfig);

        if (!config.model.url) {
            throw new Error(
                "Model URL is empty. Set `model.path` in config.json.",
            );
        }

        // Defensive cleanup if hot reload or duplicate script injection happened.
        if (app) {
            try {
                app.destroy(true, {
                    children: true,
                    texture: false,
                    baseTexture: false,
                });
            } catch {}
            app = null;
        }

        const canvas = getCanvas();
        app = await createPixiApp(canvas);

        model = await Live2DModel.from(config.model.url);

        // Ensure only one model exists in stage.
        app.stage.removeChildren();
        app.stage.addChild(model);

        const scale = Number(config.model.scale) || DEFAULTS.model.scale;
        model.scale.set(scale);

        if (model.anchor && typeof model.anchor.set === "function") {
            model.anchor.set(
                Number(config.model.anchorX ?? DEFAULTS.model.anchorX),
                Number(config.model.anchorY ?? DEFAULTS.model.anchorY),
            );
        }

        model.x = Number(config.model.x ?? DEFAULTS.model.x);
        model.y = Number(config.model.y ?? DEFAULTS.model.y);

        const baseY = model.y;
        const coreModel = model.internalModel && model.internalModel.coreModel;

        const eyeCfg = config.behavior.eyeFollowMouse || {};
        const breathingCfg = config.behavior.breathing || {};
        const mouseTracker = setupMouseTracking(config);
        const dragController = setupWindowDragging();

        let t = 0;

        app.ticker.add((delta) => {
            const dt = Math.max(0.001, delta / 60);

            if (eyeCfg.enabled !== false) {
                mouseTracker.update();
            }

            if (breathingCfg.enabled !== false) {
                const amp = Number(breathingCfg.amplitude ?? 0.5);
                const speed = Number(breathingCfg.speed ?? 1);
                t += dt * speed;

                const wave = Math.sin(t * 2.0);
                setParam(coreModel, "ParamBreath", wave * amp);
                setParam(
                    coreModel,
                    "ParamBodyAngleX",
                    Math.sin(t * 1.3) * amp * 5,
                );
                setParam(coreModel, "ParamAngleZ", Math.sin(t * 1.7) * amp * 2);

                // Visual fallback if model lacks dedicated breathing params.
                model.y = baseY + Math.sin(t * 2.0) * amp * 2.0;
            } else {
                model.y = baseY;
            }
        });

        window.addEventListener("beforeunload", () => {
            mouseTracker.dispose();
            dragController.dispose();
            if (app) {
                try {
                    app.destroy(true, {
                        children: true,
                        texture: false,
                        baseTexture: false,
                    });
                } catch {}
                app = null;
            }
        });
    }

    main().catch((error) => {
        console.error("[renderer] Failed to initialize Live2D scene:", error);
        showError(`Failed to initialize Live2D scene: ${error.message}`);
    });
})();
