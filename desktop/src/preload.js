const { contextBridge, ipcRenderer } = require("electron");

function readClipboardText() {
  return ipcRenderer.sendSync("desktop:clipboard:read-text");
}

function writeClipboardText(value) {
  return ipcRenderer.sendSync("desktop:clipboard:write-text", value);
}

function isTextInput(element) {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (!(element instanceof HTMLInputElement)) {
    return false;
  }

  const supportedTypes = new Set([
    "text",
    "password",
    "search",
    "email",
    "url",
    "tel",
    "number",
  ]);

  return supportedTypes.has((element.type || "text").toLowerCase());
}

function getEditableTarget(target) {
  if (isTextInput(target)) {
    return target;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return target;
  }

  return null;
}

function getSelectedTextFromInput(element) {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;
  return element.value.slice(start, end);
}

function replaceSelectedText(element, nextText) {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;
  element.setRangeText(nextText, start, end, "end");
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function installEditingShortcutFallback() {
  window.addEventListener(
    "keydown",
    (event) => {
      const isMac = process.platform === "darwin";
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;

      if (!modifierPressed || event.altKey || !event.key) {
        return;
      }

      const target = getEditableTarget(event.target);

      if (!target) {
        return;
      }

      const code = (event.code || "").toLowerCase();

      if (code === "keya") {
        event.preventDefault();

        if (isTextInput(target)) {
          target.focus();
          target.select();
          return;
        }

        document.execCommand("selectAll");
        return;
      }

      if (code === "keyc") {
        event.preventDefault();
        const selectedText = isTextInput(target)
          ? getSelectedTextFromInput(target)
          : window.getSelection()?.toString() ?? "";

        writeClipboardText(selectedText);
        return;
      }

      if (code === "keyx") {
        event.preventDefault();
        const selectedText = isTextInput(target)
          ? getSelectedTextFromInput(target)
          : window.getSelection()?.toString() ?? "";

        writeClipboardText(selectedText);
        if (isTextInput(target)) {
          replaceSelectedText(target, "");
          return;
        }

        document.execCommand("delete");
        return;
      }

      if (code === "keyv") {
        event.preventDefault();
        const clipboardText = readClipboardText();
        if (isTextInput(target)) {
          target.focus();
          replaceSelectedText(target, clipboardText);
          return;
        }

        document.execCommand("insertText", false, clipboardText);
      }
    },
    true,
  );

  window.addEventListener(
    "contextmenu",
    (event) => {
      const target = getEditableTarget(event.target);

      if (!target) {
        return;
      }

      event.preventDefault();
      const hasSelection = isTextInput(target)
        ? (target.selectionStart ?? 0) !== (target.selectionEnd ?? 0)
        : Boolean(window.getSelection()?.toString());

      void ipcRenderer.invoke("desktop:show-edit-context-menu", {
        x: event.clientX,
        y: event.clientY,
        hasSelection,
      });
    },
    true,
  );
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", installEditingShortcutFallback, {
    once: true,
  });
} else {
  installEditingShortcutFallback();
}

contextBridge.exposeInMainWorld("touchspaceDesktop", {
  platform: process.platform,
  isDesktopShell: true,
  isPackaged: process.env.ELECTRON_IS_PACKAGED === "true",
  getMeta: async () => ipcRenderer.invoke("desktop:get-meta"),
  openExternal: async (url) => ipcRenderer.invoke("desktop:open-external", url),
  showNotification: async (payload) =>
    ipcRenderer.invoke("desktop:show-notification", payload),
  clipboard: {
    readText: () => ipcRenderer.sendSync("desktop:clipboard:read-text"),
    writeText: (value) => ipcRenderer.sendSync("desktop:clipboard:write-text", value),
  },
  authStorage: {
    get: () => ipcRenderer.sendSync("desktop:auth-storage:get"),
    set: (rawValue) => ipcRenderer.sendSync("desktop:auth-storage:set", rawValue),
    clear: () => ipcRenderer.sendSync("desktop:auth-storage:clear"),
  },
});
