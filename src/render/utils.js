export function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, override) {
    const output = { ...(base || {}) };

    for (const [key, value] of Object.entries(override || {})) {
        const baseValue = output[key];

        if (isPlainObject(baseValue) && isPlainObject(value)) {
            output[key] = deepMerge(baseValue, value);
        } else {
            output[key] = value;
        }
    }

    return output;
}

export function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}
