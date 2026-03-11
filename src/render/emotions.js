import { setParam } from "./controllers.js";

const DEFAULT_TRANSITION_SPEED = 0.08;

export function createEmotionController({ getModel } = {}) {
    let emotionConfig = null;
    let currentEmotionKey = null;
    let targetParams = {};
    let currentParams = {};
    let transitionSpeed = DEFAULT_TRANSITION_SPEED;

    function loadEmotionConfig(config, model) {
        if (config && config.emotions && Object.keys(config.emotions).length) {
            emotionConfig = config;
        } else {
            emotionConfig = autoDetectEmotions(model);
        }

        transitionSpeed =
            emotionConfig?.transition?.speed ?? DEFAULT_TRANSITION_SPEED;

        currentParams = {};
        targetParams = {};
        currentEmotionKey = null;

        if (emotionConfig) {
            const defaultKey =
                emotionConfig.defaultEmotion || Object.keys(emotionConfig.emotions)[0];
            if (defaultKey && emotionConfig.emotions[defaultKey]) {
                setEmotion(defaultKey);
            }
        }
    }

    function autoDetectEmotions(model) {
        const settings = model?.internalModel?.settings;
        if (!settings) return null;

        const expressions =
            settings.expressions ||
            settings.fileReferences?.expressions ||
            [];

        if (!expressions.length) return null;

        const emotions = {
            neutral: { label: "Neutral", params: {} },
        };

        for (const expr of expressions) {
            const name = expr.Name || expr.name;
            if (!name) continue;
            emotions[name] = {
                label: name,
                expression: name,
                params: {},
            };
        }

        return {
            version: 1,
            defaultEmotion: "neutral",
            emotions,
        };
    }

    function getEmotionList() {
        if (!emotionConfig || !emotionConfig.emotions) return [];

        return Object.entries(emotionConfig.emotions).map(([key, entry]) => ({
            key,
            label: entry.label || key,
        }));
    }

    function getCurrentEmotion() {
        return currentEmotionKey;
    }

    function setEmotion(key) {
        if (!emotionConfig || !emotionConfig.emotions) return;

        const entry = emotionConfig.emotions[key];
        if (!entry) return;

        const prevTargetKeys = Object.keys(targetParams);

        targetParams = { ...(entry.params || {}) };

        for (const paramId of prevTargetKeys) {
            if (!(paramId in targetParams)) {
                targetParams[paramId] = 0;
            }
        }

        currentEmotionKey = key;

        const model = getModel?.();
        if (!model) return;

        if (entry.expression && typeof model.expression === "function") {
            try {
                model.expression(entry.expression);
            } catch {}
        }

        if (entry.motion && typeof model.motion === "function") {
            try {
                model.motion(entry.motion.group, entry.motion.index);
            } catch {}
        }
    }

    function getBaseValue(paramId) {
        if (typeof currentParams[paramId] === "number") {
            return currentParams[paramId];
        }
        return 0;
    }

    /**
     * Advance interpolation toward target values.
     * Call this every frame (e.g. from app.ticker) to compute smooth transitions.
     * Does NOT apply values to the model — call applyToModel() for that.
     */
    function update(dt) {
        const allParamIds = new Set([
            ...Object.keys(targetParams),
            ...Object.keys(currentParams),
        ]);

        if (!allParamIds.size) return;

        const speed = Math.min(1, transitionSpeed * (dt * 60));

        for (const paramId of allParamIds) {
            const target = targetParams[paramId] ?? 0;
            const current = currentParams[paramId] ?? 0;

            const next = current + (target - current) * speed;

            const snapped = Math.abs(next - target) < 0.001 ? target : next;
            currentParams[paramId] = snapped;

            if (snapped === 0 && !(paramId in targetParams)) {
                delete currentParams[paramId];
            }
        }
    }

    /**
     * Apply current interpolated emotion parameters to the coreModel.
     * Must be called inside the model's update pipeline (e.g. "beforeModelUpdate"
     * event) so that values are applied before coreModel.update() computes drawables.
     */
    function applyToModel(coreModel) {
        if (!coreModel) return;

        for (const [paramId, value] of Object.entries(currentParams)) {
            if (value !== 0) {
                setParam(coreModel, paramId, value);
            }
        }
    }

    function destroy() {
        emotionConfig = null;
        currentEmotionKey = null;
        targetParams = {};
        currentParams = {};
    }

    return {
        loadEmotionConfig,
        getEmotionList,
        getCurrentEmotion,
        setEmotion,
        getBaseValue,
        update,
        applyToModel,
        destroy,
    };
}
