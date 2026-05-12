const {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  Notification,
  screen,
  shell,
  nativeTheme,
  ipcMain,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

process.env.ELECTRON_IS_PACKAGED = app.isPackaged ? "true" : "false";

const isDev = !app.isPackaged;
const defaultRemoteUrl = "https://app.example.ru/login";
const startUrl = process.env.DESKTOP_START_URL || defaultRemoteUrl;
const shellOrigin = new URL(startUrl).origin;
const desktopSessionPartition = `persist:touchspace-workspace:${new URL(startUrl).host
  .replace(/[^a-z0-9.-]+/gi, "-")
  .toLowerCase()}`;
const windowIconPath = path.join(__dirname, "..", "assets", "icon.png");
const shouldOpenDevTools = process.env.DESKTOP_OPEN_DEVTOOLS === "true";
const windowsAppUserModelId = "com.touchspace.workspace";

let mainWindow = null;
let notificationWindow = null;
let notificationWindowReady = false;
let notificationWindowPendingShow = false;
let pendingNotificationPayload = null;
let lastUnreadAttentionCount = 0;
let lastDockBounceId = -1;
let isAppQuitting = false;
let desktopNotificationPollInterval = null;
let isDesktopNotificationPollInFlight = false;
const lastBackgroundNotificationMessageByKey = new Map();
let managerProfileResolveCache = null;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

if (process.platform === "win32") {
  app.setAppUserModelId(windowsAppUserModelId);
}

function getDesktopAuthSessionPath() {
  return path.join(app.getPath("userData"), "touchspace-auth-session.json");
}

function readDesktopAuthSession() {
  try {
    const filePath = getDesktopAuthSessionPath();

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const rawValue = fs.readFileSync(filePath, "utf8").trim();
    return rawValue || null;
  } catch {
    return null;
  }
}

function writeDesktopAuthSession(rawValue) {
  try {
    fs.writeFileSync(getDesktopAuthSessionPath(), rawValue, "utf8");
    return true;
  } catch {
    return false;
  }
}

function clearDesktopAuthSession() {
  try {
    const filePath = getDesktopAuthSessionPath();

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return true;
  } catch {
    return false;
  }
}

function getDesktopApiBaseUrl() {
  if (process.env.DESKTOP_API_BASE_URL?.trim()) {
    return process.env.DESKTOP_API_BASE_URL.trim().replace(/\/$/, "");
  }

  const start = new URL(startUrl);

  if (start.hostname === "localhost" || start.hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }

  if (start.hostname.startsWith("app.")) {
    return `${start.protocol}//api.${start.hostname.slice(4)}`;
  }

  return start.origin;
}

function readDesktopAuthSessionJson() {
  const rawValue = readDesktopAuthSession();

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function getDesktopManagerProfileId() {
  const session = readDesktopAuthSessionJson();
  const role = typeof session?.role === "string" ? session.role : "";

  if (role !== "manager" && role !== "manager_supervisor") {
    return "";
  }

  return (
    (typeof session.managerId === "string" && session.managerId.trim()) ||
    (typeof session.userId === "string" && session.userId.trim()) ||
    ""
  );
}

function getDesktopManagerName() {
  const session = readDesktopAuthSessionJson();

  return (
    (typeof session?.managerName === "string" && session.managerName.trim()) ||
    (typeof session?.fullName === "string" && session.fullName.trim()) ||
    "Менеджер"
  );
}

function normalizeProfileName(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU")
    : "";
}

async function resolveDesktopManagerProfileId(profileId, managerName) {
  const normalizedProfileId = typeof profileId === "string" ? profileId.trim() : "";

  if (!normalizedProfileId) {
    return "";
  }

  const normalizedManagerName = normalizeProfileName(managerName);
  const cacheKey = `${normalizedProfileId}:${normalizedManagerName}`;

  if (
    managerProfileResolveCache?.cacheKey === cacheKey &&
    managerProfileResolveCache.expiresAt > Date.now()
  ) {
    return managerProfileResolveCache.profileId;
  }

  let resolvedProfileId = normalizedProfileId;

  try {
    const response = await fetch(`${getDesktopApiBaseUrl()}/profiles/manager-statuses`, {
      cache: "no-store",
    });

    if (response.ok) {
      const managers = await response.json();
      const managerRecords = Array.isArray(managers) ? managers : [];
      const exactManager = managerRecords.find((manager) => manager?.id === normalizedProfileId);

      if (
        exactManager &&
        (!normalizedManagerName ||
          normalizeProfileName(exactManager.fullName) === normalizedManagerName)
      ) {
        resolvedProfileId = normalizedProfileId;
      } else if (normalizedManagerName) {
        resolvedProfileId =
          managerRecords.find(
            (manager) => normalizeProfileName(manager?.fullName) === normalizedManagerName,
          )?.id ||
          exactManager?.id ||
          normalizedProfileId;
      }
    }
  } catch {
    resolvedProfileId = normalizedProfileId;
  }

  managerProfileResolveCache = {
    cacheKey,
    profileId: resolvedProfileId,
    expiresAt: Date.now() + 60_000,
  };

  return resolvedProfileId;
}

function isMainWindowInBackground() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  return mainWindow.isMinimized() || !mainWindow.isFocused() || !mainWindow.isVisible();
}

function buildManagerNotificationPayload(candidate) {
  const isDirectSupplierDialog = candidate?.conversationMode === "direct_supplier";
  const isClaimedByOther = candidate?.scopeStatus === "claimed_by_other_recently";
  const title =
    isClaimedByOther
      ? "Чат уже взят в работу"
      : candidate?.tradePointName?.trim() ||
        candidate?.title ||
        candidate?.clientName ||
        "Неизвестная торговая точка";
  const body =
    typeof candidate?.messageText === "string" && candidate.messageText.length > 80
      ? `${candidate.messageText.slice(0, 80)}...`
      : String(candidate?.messageText || "");
  const subtitle =
    isClaimedByOther && candidate?.assignedManagerName
      ? `Уже ведёт ${candidate.assignedManagerName}`
      : isClaimedByOther
        ? "Чат уже забрал другой менеджер"
        : "";
  const metaLabel =
    candidate?.scopeStatus === "missed_unclaimed"
      ? "Пропущенное сообщение более 10 минут"
      : candidate?.scopeStatus === "rescue_queue"
        ? "Чат возвращён в общую очередь"
        : candidate?.scopeStatus === "owned_active"
          ? "Новое сообщение в вашем диалоге"
          : Number(candidate?.waitSeconds) > 0
            ? `Ожидание ${Math.floor(Number(candidate.waitSeconds) / 60)} мин ${
                Number(candidate.waitSeconds) % 60
              } сек`
            : "";
  const primaryLabel =
    isClaimedByOther
      ? "Открыть"
      : candidate?.scopeStatus === "new_unclaimed" ||
          candidate?.scopeStatus === "missed_unclaimed" ||
          candidate?.scopeStatus === "rescue_queue"
        ? "Взять в работу"
        : "Ответить";

  return {
    title,
    body,
    url: candidate?.ticketId ? `/?ticket=${candidate.ticketId}` : startUrl,
    subtitle,
    metaLabel,
    primaryLabel,
    secondaryLabel: "Позже",
    header: "Входящее сообщение",
    ticketId: candidate?.ticketId,
    scopeStatus: candidate?.scopeStatus,
    avatarEmoji: candidate?.avatarEmoji || "",
    avatarColor: candidate?.avatarColor || "",
    tone: isDirectSupplierDialog ? "green" : "blue",
    tag: candidate?.notificationKey,
    messageId: candidate?.messageId,
  };
}

async function pollDesktopManagerNotifications() {
  if (
    isDesktopNotificationPollInFlight ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    typeof fetch !== "function"
  ) {
    return;
  }

  const profileId = await resolveDesktopManagerProfileId(
    getDesktopManagerProfileId(),
    getDesktopManagerName(),
  );

  if (!profileId) {
    lastBackgroundNotificationMessageByKey.clear();
    return;
  }

  isDesktopNotificationPollInFlight = true;

  try {
    const shouldShowOverlay = isMainWindowInBackground();
    const response = await fetch(
      `${getDesktopApiBaseUrl()}/notifications/manager-candidates?profileId=${encodeURIComponent(
        profileId,
      )}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const candidates = Array.isArray(payload?.items) ? payload.items : [];
    const activeKeys = new Set();

    candidates.forEach((candidate) => {
      const notificationKey =
        typeof candidate?.notificationKey === "string" ? candidate.notificationKey : "";
      const messageId = typeof candidate?.messageId === "string" ? candidate.messageId : "";

      if (!notificationKey || !messageId) {
        return;
      }

      activeKeys.add(notificationKey);

      if (candidate.scopeStatus === "claimed_by_other_recently" || !shouldShowOverlay) {
        lastBackgroundNotificationMessageByKey.set(notificationKey, messageId);
        return;
      }

      if (lastBackgroundNotificationMessageByKey.get(notificationKey) === messageId) {
        return;
      }

      lastBackgroundNotificationMessageByKey.set(notificationKey, messageId);
      showOverlayNotificationWindow(buildManagerNotificationPayload(candidate));
    });

    Array.from(lastBackgroundNotificationMessageByKey.keys()).forEach((key) => {
      if (!activeKeys.has(key)) {
        lastBackgroundNotificationMessageByKey.delete(key);
      }
    });
  } catch {
    return;
  } finally {
    isDesktopNotificationPollInFlight = false;
  }
}

function startDesktopNotificationPolling() {
  if (desktopNotificationPollInterval) {
    return;
  }

  desktopNotificationPollInterval = setInterval(() => {
    void pollDesktopManagerNotifications();
  }, 1000);
}

function stopDesktopNotificationPolling() {
  if (!desktopNotificationPollInterval) {
    return;
  }

  clearInterval(desktopNotificationPollInterval);
  desktopNotificationPollInterval = null;
}

function createMenu() {
  const template = [
    {
      label: "TouchSpace",
      submenu: [
        {
          label: "Открыть рабочую зону",
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              void mainWindow.loadURL(startUrl);
            }
          },
        },
        {
          label: "Перезагрузить",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            mainWindow?.reload();
          },
        },
        { type: "separator" },
        {
          label: "Выйти",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Редактирование",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { role: "pasteAndMatchStyle", label: "Вставить без форматирования" },
        { role: "delete", label: "Удалить" },
        { role: "selectAll", label: "Выделить всё" },
      ],
    },
    {
      label: "Окно",
      submenu: [
        { role: "minimize", label: "Свернуть" },
        { role: "togglefullscreen", label: "Во весь экран" },
      ],
    },
    {
      label: "Помощь",
      submenu: [
        {
          label: "Открыть TouchSpace в браузере",
          click: () => void shell.openExternal(startUrl),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createEditableContextMenu(window, params, popupOptions = {}) {
  const menu = Menu.buildFromTemplate([
    { role: "undo", label: "Отменить", enabled: params.editFlags.canUndo },
    { role: "redo", label: "Повторить", enabled: params.editFlags.canRedo },
    { type: "separator" },
    { role: "cut", label: "Вырезать", enabled: params.editFlags.canCut },
    { role: "copy", label: "Копировать", enabled: params.editFlags.canCopy },
    { role: "paste", label: "Вставить", enabled: params.editFlags.canPaste },
    {
      role: "pasteAndMatchStyle",
      label: "Вставить без форматирования",
      enabled: params.editFlags.canPaste,
    },
    { role: "delete", label: "Удалить" },
    { type: "separator" },
    { role: "selectAll", label: "Выделить всё" },
  ]);

  menu.popup({
    window,
    ...popupOptions,
  });
}

function parseUnreadCountFromTitle(title) {
  if (typeof title !== "string") {
    return 0;
  }

  const match = title.match(/^\((\d+)\)/);

  if (!match) {
    return 0;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clearDesktopAttention() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(false);
  }

  if (typeof app.setBadgeCount === "function") {
    app.setBadgeCount(0);
  }

  if (process.platform === "darwin" && app.dock && lastDockBounceId !== -1) {
    app.dock.cancelBounce(lastDockBounceId);
    lastDockBounceId = -1;
  }

  lastUnreadAttentionCount = 0;
}

function ensureDockIconVisible() {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  void app.dock.show();
  app.dock.setIcon(windowIconPath);
}

function keepMainWindowInTaskbar() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setSkipTaskbar(false);
}

function keepDesktopAppVisible() {
  ensureDockIconVisible();
  keepMainWindowInTaskbar();
}

function getOverlayNotificationBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const width = 456;
  const height = 332;
  const margin = 18;

  return {
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - margin),
    y: Math.round(workArea.y + workArea.height - height - margin),
  };
}

function hideOverlayNotificationWindow() {
  if (!notificationWindow || notificationWindow.isDestroyed()) {
    return;
  }

  notificationWindow.hide();
  keepMainWindowInTaskbar();
}

function focusMainWindow(targetUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  if (!mainWindow) {
    return;
  }

  if (process.platform === "darwin") {
    app.focus({ steal: true });
    keepDesktopAppVisible();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();

  if (!targetUrl) {
    return;
  }

  try {
    const parsedTarget = new URL(targetUrl, startUrl);

    if (parsedTarget.origin === shellOrigin) {
      void mainWindow.loadURL(parsedTarget.toString());
    }
  } catch {
    return;
  }
}

function sendOverlayNotificationPayload() {
  if (
    !notificationWindow ||
    notificationWindow.isDestroyed() ||
    !notificationWindowReady ||
    !pendingNotificationPayload
  ) {
    return;
  }

  notificationWindow.webContents.send(
    "desktop:overlay-notification-data",
    pendingNotificationPayload,
  );
}

function createNotificationWindow() {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    return notificationWindow;
  }

  const bounds = getOverlayNotificationBounds();

  notificationWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    roundedCorners: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "notification-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false,
    },
  });

  notificationWindow.setAlwaysOnTop(true, "screen-saver");
  notificationWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  notificationWindow.setFocusable(false);

  notificationWindow.on("close", (event) => {
    if (isAppQuitting) {
      return;
    }

    event.preventDefault();
    notificationWindow?.hide();
  });

  notificationWindow.on("closed", () => {
    notificationWindow = null;
    notificationWindowReady = false;
    notificationWindowPendingShow = false;
  });

  notificationWindow.webContents.on("did-finish-load", () => {
    notificationWindowReady = true;
    sendOverlayNotificationPayload();
  });

  void notificationWindow.loadFile(path.join(__dirname, "notification.html"));
  return notificationWindow;
}

function showOverlayNotificationWindow(payload) {
  pendingNotificationPayload = payload;
  notificationWindowPendingShow = true;
  keepDesktopAppVisible();
  const overlay = createNotificationWindow();

  if (!overlay) {
    return false;
  }

  const bounds = getOverlayNotificationBounds();
  overlay.setBounds(bounds);
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  sendOverlayNotificationPayload();
  keepDesktopAppVisible();
  requestDesktopAttention(Math.max(lastUnreadAttentionCount + 1, 1));
  return true;
}

function requestDesktopAttention(unreadCount) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  keepDesktopAppVisible();

  if (typeof app.setBadgeCount === "function") {
    app.setBadgeCount(unreadCount);
  }

  if (mainWindow.isFocused()) {
    lastUnreadAttentionCount = unreadCount;
    return;
  }

  if (process.platform === "darwin" && app.dock) {
    if (lastDockBounceId !== -1) {
      app.dock.cancelBounce(lastDockBounceId);
    }

    lastDockBounceId = app.dock.bounce("informational");
  }

  mainWindow.flashFrame(true);
  lastUnreadAttentionCount = unreadCount;
}

function syncDesktopAttentionFromTitle(title) {
  const unreadCount = parseUnreadCountFromTitle(title);

  if (unreadCount <= 0) {
    clearDesktopAttention();
    return;
  }

  if (unreadCount > lastUnreadAttentionCount) {
    requestDesktopAttention(unreadCount);
    return;
  }

  if (typeof app.setBadgeCount === "function") {
    app.setBadgeCount(unreadCount);
  }

  lastUnreadAttentionCount = unreadCount;
}

function registerEditingShortcuts(window) {
  window.webContents.on("before-input-event", (event, input) => {
    const modifierPressed = process.platform === "darwin" ? input.meta : input.control;

    if (!modifierPressed || !input.key) {
      return;
    }

    const normalizedCode = (input.code || "").toLowerCase();

    if (normalizedCode === "keya") {
      event.preventDefault();
      window.webContents.selectAll();
      return;
    }

    if (normalizedCode === "keyc") {
      event.preventDefault();
      window.webContents.copy();
      return;
    }

    if (normalizedCode === "keyx") {
      event.preventDefault();
      window.webContents.cut();
      return;
    }

    if (normalizedCode === "keyv") {
      event.preventDefault();
      if (input.shift && process.platform === "darwin") {
        window.webContents.pasteAndMatchStyle();
        return;
      }

      window.webContents.paste();
      return;
    }

    if (normalizedCode === "keyz") {
      event.preventDefault();
      if (input.shift) {
        window.webContents.redo();
        return;
      }

      window.webContents.undo();
      return;
    }

    if (normalizedCode === "keyy" && process.platform !== "darwin") {
      event.preventDefault();
      window.webContents.redo();
    }
  });
}

function createWindow() {
  nativeTheme.themeSource = "light";

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "TouchSpace Workspace",
    backgroundColor: "#eff4ff",
    show: false,
    skipTaskbar: false,
    autoHideMenuBar: false,
    icon: windowIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
      partition: desktopSessionPartition,
    },
  });

  Menu.setApplicationMenu(createMenu());
  keepMainWindowInTaskbar();
  registerEditingShortcuts(mainWindow);

  mainWindow.once("ready-to-show", () => {
    if (process.platform === "darwin") {
      ensureDockIconVisible();
      app.focus({ steal: true });
    }

    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on("focus", () => {
    clearDesktopAttention();
    hideOverlayNotificationWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;

    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.destroy();
    }

    notificationWindow = null;
    notificationWindowReady = false;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const parsed = new URL(url);

    if (parsed.origin !== shellOrigin && !url.startsWith("file://")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("context-menu", (event, params) => {
    if (params.isEditable || params.selectionText) {
      event.preventDefault();
      createEditableContextMenu(mainWindow, params);
    }
  });

  if (isDev && shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    mainWindow?.setTitle(title);
    syncDesktopAttentionFromTitle(title);
  });

  void mainWindow.loadURL(startUrl);
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(windowIconPath);
    void app.dock.show();
  }

  ipcMain.handle("desktop:get-meta", () => ({
    isDesktopShell: true,
    isPackaged: app.isPackaged,
    platform: process.platform,
    startUrl,
  }));

  ipcMain.handle("desktop:show-notification", async (_, payload) => {
    if (!payload?.title) {
      return false;
    }

    const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : "";
    const messageId =
      typeof payload.messageId === "string" && payload.messageId.trim()
        ? payload.messageId.trim()
        : "";

    if (tag && messageId) {
      lastBackgroundNotificationMessageByKey.set(tag, messageId);
    }

    return showOverlayNotificationWindow({
      title: String(payload.title),
      body: typeof payload.body === "string" ? payload.body : "",
      url:
        typeof payload.url === "string" && payload.url.trim()
          ? payload.url.trim()
          : startUrl,
      subtitle:
        typeof payload.subtitle === "string" && payload.subtitle.trim()
          ? payload.subtitle.trim()
          : "",
      metaLabel:
        typeof payload.metaLabel === "string" && payload.metaLabel.trim()
          ? payload.metaLabel.trim()
          : "",
      primaryLabel:
        typeof payload.primaryLabel === "string" && payload.primaryLabel.trim()
          ? payload.primaryLabel.trim()
          : "Открыть",
      secondaryLabel:
        typeof payload.secondaryLabel === "string" && payload.secondaryLabel.trim()
          ? payload.secondaryLabel.trim()
          : "Позже",
      header:
        typeof payload.header === "string" && payload.header.trim()
          ? payload.header.trim()
          : "Входящее сообщение",
      avatarEmoji:
        typeof payload.avatarEmoji === "string" && payload.avatarEmoji.trim()
          ? payload.avatarEmoji.trim()
          : "",
      avatarColor:
        typeof payload.avatarColor === "string" && payload.avatarColor.trim()
          ? payload.avatarColor.trim()
          : "",
      tone:
        payload.tone === "green" || payload.tone === "amber"
          ? payload.tone
          : "blue",
      tag,
      ticketId:
        typeof payload.ticketId === "string" && payload.ticketId.trim()
          ? payload.ticketId.trim()
          : "",
      scopeStatus:
        typeof payload.scopeStatus === "string" && payload.scopeStatus.trim()
          ? payload.scopeStatus.trim()
          : "",
    });
  });

  ipcMain.handle("desktop:overlay-notification-action", async (_, payload) => {
    const action = payload?.action;

    if (action === "primary") {
      const ticketId =
        typeof pendingNotificationPayload?.ticketId === "string"
          ? pendingNotificationPayload.ticketId.trim()
          : "";
      const primaryLabel =
        typeof pendingNotificationPayload?.primaryLabel === "string"
          ? pendingNotificationPayload.primaryLabel.trim()
          : "";
      const shouldClaimTicket = ticketId && primaryLabel === "Взять в работу";

      if (shouldClaimTicket) {
        const managerName = getDesktopManagerName();
        const managerId = await resolveDesktopManagerProfileId(
          getDesktopManagerProfileId(),
          managerName,
        );

        if (managerId) {
          try {
            await fetch(`${getDesktopApiBaseUrl()}/tickets/${encodeURIComponent(ticketId)}/claim`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                managerId,
                managerName,
                resolverRole: "manager",
              }),
            });
          } catch {
            // The renderer will refresh the ticket state after focus even if claim fails.
          }
        }
      }

      focusMainWindow(
        typeof payload?.url === "string" && payload.url.trim()
          ? payload.url.trim()
          : startUrl,
      );
      hideOverlayNotificationWindow();
      return true;
    }

    hideOverlayNotificationWindow();
    return true;
  });

  ipcMain.on("desktop:overlay-notification-rendered", () => {
    if (
      !notificationWindowPendingShow ||
      !notificationWindow ||
      notificationWindow.isDestroyed()
    ) {
      return;
    }

    notificationWindowPendingShow = false;
    notificationWindow.setAlwaysOnTop(true, "screen-saver");
    notificationWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    notificationWindow.showInactive();
    notificationWindow.moveTop();
    keepDesktopAppVisible();
    setTimeout(keepDesktopAppVisible, 250);
  });

  ipcMain.on("desktop:auth-storage:get", (event) => {
    event.returnValue = readDesktopAuthSession();
  });

  ipcMain.on("desktop:auth-storage:set", (event, rawValue) => {
    managerProfileResolveCache = null;
    event.returnValue =
      typeof rawValue === "string" && rawValue.trim()
        ? writeDesktopAuthSession(rawValue)
        : false;
  });

  ipcMain.on("desktop:auth-storage:clear", (event) => {
    lastBackgroundNotificationMessageByKey.clear();
    managerProfileResolveCache = null;
    event.returnValue = clearDesktopAuthSession();
  });

  ipcMain.on("desktop:clipboard:read-text", (event) => {
    event.returnValue = clipboard.readText();
  });

  ipcMain.on("desktop:clipboard:write-text", (event, value) => {
    clipboard.writeText(typeof value === "string" ? value : "");
    event.returnValue = true;
  });

  ipcMain.handle("desktop:show-edit-context-menu", (event, payload) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return false;
    }

    createEditableContextMenu(
      window,
      {
        editFlags: {
          canUndo: true,
          canRedo: true,
          canCut: true,
          canCopy: Boolean(payload?.hasSelection),
          canPaste: true,
        },
      },
      typeof payload?.x === "number" && typeof payload?.y === "number"
        ? { x: Math.round(payload.x), y: Math.round(payload.y) }
        : {},
    );

    return true;
  });

  ipcMain.handle("desktop:open-external", async (_, url) => {
    if (typeof url !== "string" || !url.trim()) {
      return false;
    }

    await shell.openExternal(url);
    return true;
  });

  createWindow();
  startDesktopNotificationPolling();

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }

    if (process.platform === "darwin") {
      ensureDockIconVisible();
      app.focus({ steal: true });
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });
});

app.on("before-quit", () => {
  isAppQuitting = true;
  stopDesktopNotificationPolling();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("second-instance", () => {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
});

app.on("web-contents-created", (_, contents) => {
  contents.session.setPermissionRequestHandler((_, permission, callback) => {
    if (permission === "notifications") {
      callback(false);
      return;
    }

    callback(false);
  });
});

app.on("browser-window-focus", () => {
  clearDesktopAttention();
});
