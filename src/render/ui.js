const ERROR_OVERLAY_ID = "mascot-error-overlay";
const WELCOME_ROOT_ID = "welcome-root";

function applyStyles(node, styles) {
    Object.assign(node.style, styles);
}

function createErrorOverlay() {
    let overlay = document.getElementById(ERROR_OVERLAY_ID);

    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = ERROR_OVERLAY_ID;

    applyStyles(overlay, {
        position: "fixed",
        left: "12px",
        right: "12px",
        bottom: "12px",
        padding: "10px 12px",
        borderRadius: "8px",
        background: "rgba(0, 0, 0, 0.7)",
        color: "#fff",
        fontFamily: "sans-serif",
        fontSize: "13px",
        lineHeight: "1.4",
        zIndex: "99999",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    });

    document.body.appendChild(overlay);
    return overlay;
}

function createWelcomeRoot({ projectName, onPickModel }) {
    let root = document.getElementById(WELCOME_ROOT_ID);

    if (root) return root;

    root = document.createElement("div");
    root.id = WELCOME_ROOT_ID;
    root.setAttribute("data-no-drag", "true");

    applyStyles(root, {
        position: "fixed",
        inset: "0",
        zIndex: "9000",
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
    });

    const card = document.createElement("div");
    card.setAttribute("data-no-drag", "true");

    applyStyles(card, {
        minWidth: "280px",
        maxWidth: "420px",
        padding: "20px",
        borderRadius: "12px",
        background: "rgba(0, 0, 0, 0.55)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        backdropFilter: "blur(4px)",
        color: "#fff",
        fontFamily: "sans-serif",
        textAlign: "center",
    });

    const title = document.createElement("h2");
    title.id = "welcome-title";
    title.textContent = `Welcome to ${projectName || "DesktopMascot"}`;

    applyStyles(title, {
        margin: "0 0 10px 0",
        fontSize: "22px",
        fontWeight: "700",
    });

    const description = document.createElement("p");
    description.textContent =
        "Select a Live2D .model3.json file to start your mascot.";

    applyStyles(description, {
        margin: "0 0 16px 0",
        fontSize: "14px",
        opacity: "0.9",
    });

    const button = document.createElement("button");
    button.id = "pick-model-button";
    button.type = "button";
    button.setAttribute("data-no-drag", "true");
    button.textContent = "Choose Live2D Model";

    applyStyles(button, {
        padding: "10px 14px",
        border: "0",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "14px",
        color: "#fff",
        background: "#ff7aa2",
    });

    button.addEventListener("click", async (event) => {
        event.stopPropagation();

        if (typeof onPickModel !== "function") return;

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Opening...";

        try {
            await onPickModel();
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(button);
    root.appendChild(card);
    document.body.appendChild(root);

    return root;
}

export function createUiController({ projectName, onPickModel } = {}) {
    const root = createWelcomeRoot({ projectName, onPickModel });

    function setProjectName(name) {
        const title = root.querySelector("#welcome-title");
        if (title) {
            title.textContent = `Welcome to ${name || "DesktopMascot"}`;
        }
    }

    function showWelcome() {
        root.style.display = "flex";
    }

    function hideWelcome() {
        root.style.display = "none";
    }

    function showError(message) {
        const overlay = createErrorOverlay();
        overlay.textContent = String(message ?? "Unknown error");
    }

    function clearError() {
        const overlay = document.getElementById(ERROR_OVERLAY_ID);
        if (overlay) overlay.remove();
    }

    function destroy() {
        clearError();
        const currentRoot = document.getElementById(WELCOME_ROOT_ID);
        if (currentRoot) currentRoot.remove();
    }

    return {
        setProjectName,
        showWelcome,
        hideWelcome,
        showError,
        clearError,
        destroy,
    };
}
