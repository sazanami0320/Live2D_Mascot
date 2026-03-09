import { deepMerge } from "./render/utils.js";
import { createUiController } from "./render/ui.js";
import {
    createModelController,
    createCursorTracker,
    createWindowDragController,
    setParam,
} from "./render/controllers.js";

(() => {
    if (window.__MASCOT_RENDERER_INITIALIZED__) {
        console.warn("[renderer] Initialization skipped: already initialized.");
        return;
    }
    window.__MASCOT_RENDERER_INITIALIZED__ = true;

    const DEFAULTS = {
        projectName: "DesktopMascot",
        model: {
            url: "",
            scale: 0.28,
            anchorX: 0.5,
            anchorY: 1,
        },
        window: {
            maxWidth: 800,
            maxHeight: 1000,
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

    function getOrCreateCanvas() {
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

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        return canvas;
    }

    function createPixiApp(canvas) {
        const PIXI = window.PIXI;
        if (!PIXI?.Application) {
            throw new Error("PixiJS is not available.");
        }

        return new PIXI.Application({
            view: canvas,
            autoStart: true,
            antialias: true,
            autoDensity: true,
            backgroundAlpha: 0,
            resizeTo: window,
            clearBeforeRender: true,
            preserveDrawingBuffer: false,
        });
    }

    async function main() {
        const mascotAPI = window.mascotAPI || {};
        const rawConfig =
            typeof mascotAPI.getConfig === "function"
                ? await mascotAPI.getConfig()
                : {};
        const config = deepMerge(DEFAULTS, rawConfig || {});

        let ui = null;

        ui = createUiController({
            projectName: config.projectName,
            onPickModel: async () => {
                if (typeof mascotAPI.openModelPicker !== "function") {
                    ui.showError("Model picker is unavailable.");
                    return;
                }

                try {
                    const result = await mascotAPI.openModelPicker();
                    if (!result?.ok && !result?.canceled) {
                        ui.showError("Failed to select model.");
                    }
                } catch (error) {
                    ui.showError(
                        `Failed to open model picker: ${error.message}`,
                    );
                }
            },
        });

        ui.setProjectName(config.projectName);

        const app = createPixiApp(getOrCreateCanvas());

        const modelController = createModelController({
            app,
            mascotAPI,
            getConfig: () => config,
            onModelLoaded: () => {
                ui.hideWelcome();
                ui.clearError();
            },
        });

        const cursorTracker = createCursorTracker({
            mascotAPI,
            getConfig: () => config,
            getModel: () => modelController.getCurrentModel(),
        });

        const dragController = createWindowDragController({ mascotAPI });

        cursorTracker.start();

        const startupModelUrl = config.model?.url;

        const isLoadableFileUrl =
            typeof startupModelUrl === "string" &&
            startupModelUrl.trim().length > 0 &&
            startupModelUrl.toLowerCase() !== "null" &&
            startupModelUrl.toLowerCase() !== "undefined" &&
            startupModelUrl.startsWith("file://");

        if (isLoadableFileUrl) {
            try {
                await modelController.loadModelByUrl(startupModelUrl);
            } catch (error) {
                console.error(
                    "[renderer] Failed to load startup model:",
                    error,
                );
                ui.showError(`Failed to load model: ${error.message}`);
                ui.showWelcome();
            }
        } else {
            ui.showWelcome();
        }

        let unsubscribeSwitchModel = () => {};
        if (typeof mascotAPI.onSwitchModel === "function") {
            unsubscribeSwitchModel = mascotAPI.onSwitchModel(
                async (payload) => {
                    const nextUrl = payload?.url;
                    if (!nextUrl || typeof nextUrl !== "string") return;

                    try {
                        await modelController.loadModelByUrl(nextUrl);
                    } catch (error) {
                        console.error(
                            "[renderer] Failed to switch model:",
                            error,
                        );
                        ui.showError(
                            `Failed to switch model: ${error.message}`,
                        );
                    }
                },
            );
        }

        let t = 0;
        app.ticker.add((delta) => {
            const dt = Math.max(0.001, delta / 60);

            if (config.behavior?.eyeFollowMouse?.enabled !== false) {
                cursorTracker.update();
            }

            const model = modelController.getCurrentModel();
            if (!model) return;

            const breathingCfg = config.behavior?.breathing || {};
            const baseY = modelController.getBreathingBaseY();

            if (breathingCfg.enabled !== false) {
                const amp = Number(breathingCfg.amplitude ?? 0.5);
                const speed = Number(breathingCfg.speed ?? 1);
                t += dt * speed;

                const coreModel = model.internalModel?.coreModel;
                const wave = Math.sin(t * 2.0);

                setParam(coreModel, "ParamBreath", wave * amp);
                setParam(
                    coreModel,
                    "ParamBodyAngleX",
                    Math.sin(t * 1.3) * amp * 5,
                );
                setParam(coreModel, "ParamAngleZ", Math.sin(t * 1.7) * amp * 2);

                model.y = baseY + Math.sin(t * 2.0) * amp * 2.0;
            } else {
                model.y = baseY;
            }
        });

        const handleResize = () => {
            modelController.placeModel();
        };

        window.addEventListener("resize", handleResize);

        window.addEventListener("beforeunload", () => {
            window.removeEventListener("resize", handleResize);

            unsubscribeSwitchModel?.();
            cursorTracker.destroy?.();
            dragController.destroy?.();
            modelController.destroy?.();
            ui.destroy?.();

            try {
                app.destroy?.(true, {
                    children: true,
                    texture: false,
                    baseTexture: false,
                });
            } catch {}
        });
    }

    main().catch((error) => {
        console.error("[renderer] Failed to initialize Live2D scene:", error);

        const fallbackUi = createUiController({
            projectName: "DesktopMascot",
            onPickModel: async () => {},
        });
        fallbackUi.showError(
            `Failed to initialize Live2D scene: ${error.message}`,
        );
        fallbackUi.showWelcome();
    });
})();
