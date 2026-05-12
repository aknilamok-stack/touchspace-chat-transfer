(function () {
  if (window.TouchSpaceChatWidget) {
    return;
  }

  var currentScript = document.currentScript;
  var scriptUrl = currentScript && currentScript.src ? new URL(currentScript.src) : null;
  var defaultBaseUrl = scriptUrl ? scriptUrl.origin : window.location.origin;
  var config = window.TouchSpaceChatConfig || {};
  var baseUrl = (config.baseUrl || defaultBaseUrl || "").replace(/\/$/, "");

  function readText(selector) {
    if (!selector) {
      return "";
    }

    try {
      var element = document.querySelector(selector);
      return element && element.textContent ? element.textContent.trim() : "";
    } catch (_) {
      return "";
    }
  }

  function cleanValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeValue(value) {
    return cleanValue(value).replace(/\s+/g, " ").trim();
  }

  function pickFirst() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return "";
  }

  function getTradePointNameFromDom() {
    try {
      var items = document.querySelectorAll(".pane__list_desktop .pane__list-item");

      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        var labelEl = item.querySelector(".pane__list-label");
        var valueEl = item.querySelector(".pane__list-value span");

        if (!valueEl) {
          valueEl = item.querySelector(".pane__list-value");
        }

        var label = normalizeValue(labelEl ? labelEl.textContent : "");
        var value = normalizeValue(valueEl ? valueEl.textContent : "");

        if ((label === "Торговая точка" || label === "Торговая точка:") && value) {
          return value;
        }
      }
    } catch (_) {
      return "";
    }

    return "";
  }

  function getLegalEntityNameFromDom() {
    try {
      var items = document.querySelectorAll(".pane__list_desktop .pane__list-item");

      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        var labelEl = item.querySelector(".pane__list-label");
        var valueEl = item.querySelector(".pane__list-value span");

        if (!valueEl) {
          valueEl = item.querySelector(".pane__list-value");
        }

        var label = normalizeValue(labelEl ? labelEl.textContent : "");
        var value = normalizeValue(valueEl ? valueEl.textContent : "");

        if ((label === "Юр.лицо" || label === "Юр.лицо:") && value) {
          return value;
        }
      }
    } catch (_) {
      return "";
    }

    return "";
  }

  var domTradePointName = getTradePointNameFromDom();
  var domLegalEntityName = getLegalEntityNameFromDom();
  var configuredTradePointId = cleanValue(config.tradePointId);
  var configuredTradePointExternalId = cleanValue(config.tradePointExternalId);
  var configuredTradePointName = cleanValue(config.tradePointName);
  var configuredCurrentUserId = pickFirst(
    cleanValue(config.currentUserId),
    cleanValue(config.platformUserId),
    cleanValue(config.userId)
  );
  var configuredCurrentUserLogin = cleanValue(config.currentUserLogin);
  var configuredCurrentUserEmail = pickFirst(
    cleanValue(config.currentUserEmail),
    cleanValue(config.email)
  );
  var configuredCurrentUserPhone = pickFirst(
    cleanValue(config.currentUserPhone),
    cleanValue(config.phone)
  );
  var configuredCurrentUserXmlId = cleanValue(config.currentUserXmlId);
  var configuredIsSuperuser =
    typeof config.isSuperuser === "boolean"
      ? config.isSuperuser
      : cleanValue(String(config.isSuperuser)).toLowerCase() === "true";
  var configuredSuperuserId = cleanValue(config.superuserId);
  var configuredSuperuserEmail = cleanValue(config.superuserEmail);
  var configuredSuperuserPhone = cleanValue(config.superuserPhone);
  var configuredCanonicalEmail = pickFirst(
    cleanValue(config.canonicalEmail),
    configuredSuperuserEmail,
    configuredCurrentUserEmail
  );
  var configuredCanonicalEmailSource = cleanValue(config.canonicalEmailSource);
  var configuredUserToken = pickFirst(
    cleanValue(config.userToken),
    configuredTradePointId ? "trade-point-" + configuredTradePointId : ""
  );

  var fallbackTradePointName = pickFirst(
    configuredTradePointName,
    domTradePointName,
    readText(".pane__list-value span"),
    readText(".pane__list-value"),
    cleanValue(config.name),
    readText(".sidebar__title"),
    readText(".account__title span"),
    readText(".account__title")
  );

  var fallbackTradePointId = pickFirst(
    configuredTradePointId,
    cleanValue(config.clientId),
    configuredCurrentUserId,
    cleanValue(config.userId)
  );

  var fallbackUserName = pickFirst(
    cleanValue(config.userName),
    cleanValue(config.contactName),
    cleanValue(config.name),
    domTradePointName,
    domLegalEntityName
  );

  var fallbackUserId = pickFirst(
    configuredCurrentUserId,
    fallbackTradePointId
  );

  if (!baseUrl) {
    console.error("[TouchSpace Widget] Не удалось определить baseUrl.");
    return;
  }

  var iframeUrl = new URL("/client", baseUrl);
  iframeUrl.searchParams.set("embed", "1");

  function deriveApiBaseUrl() {
    try {
      var parsedBaseUrl = new URL(baseUrl);

      if (parsedBaseUrl.hostname.indexOf("app.") === 0) {
        parsedBaseUrl.hostname = "api." + parsedBaseUrl.hostname.slice(4);
      }

      if (
        window.location.protocol === "https:" &&
        parsedBaseUrl.protocol === "http:" &&
        parsedBaseUrl.hostname !== "localhost" &&
        parsedBaseUrl.hostname !== "127.0.0.1"
      ) {
        parsedBaseUrl.protocol = "https:";
      }

      return parsedBaseUrl.toString().replace(/\/$/, "");
    } catch (_) {
      return "";
    }
  }

  function detectRouteContext(pathname) {
    var normalizedPath = cleanValue(pathname) || "/";
    var routeType = "other";
    var pageName = document.title ? document.title.trim() : "Страница";
    var entityId = "";
    var entityName = "";

    if (/^\/personal\/?$/i.test(normalizedPath)) {
      routeType = "personal";
      pageName = "Личный кабинет";
    } else if (/^\/catalog\/?$/i.test(normalizedPath)) {
      routeType = "catalog";
      pageName = "Каталог";
    } else if (/\/(item|product)\//i.test(normalizedPath)) {
      routeType = "product";
      pageName = "Карточка товара";
      var productMatch = normalizedPath.match(/\/(?:item|product)\/(\d+)/i);
      entityId = productMatch && productMatch[1] ? productMatch[1] : "";
      entityName = pickFirst(
        readText("h1"),
        readText(".page-title"),
        readText(".product-title"),
        readText(".detail__title")
      );
    } else if (/\/cart/i.test(normalizedPath)) {
      routeType = "cart";
      pageName = "Корзина";
    } else if (/\/order/i.test(normalizedPath)) {
      routeType = "order";
      pageName = "Заказ";
    } else if (/\/brands?/i.test(normalizedPath)) {
      routeType = "brands";
      pageName = "Бренды";
    } else if (/\/samples?/i.test(normalizedPath)) {
      routeType = "samples";
      pageName = "Образцы";
    }

    return {
      routeType: routeType,
      pageName: pageName,
      entityId: entityId,
      entityName: entityName,
    };
  }

  var pageTrackingState = {
    apiBaseUrl: deriveApiBaseUrl(),
    lastSignature: "",
    lastSentAt: 0,
  };
  var PAGE_VIEW_HEARTBEAT_INTERVAL_MS = 15000;

  function sendPageView() {
    if (!pageTrackingState.apiBaseUrl || !fallbackTradePointId) {
      return;
    }

    var pagePath = cleanValue(
      window.location.pathname + window.location.search + window.location.hash
    ) || "/";
    var pageTitle = cleanValue(document.title);
    var signature = pagePath + "::" + pageTitle;
    var now = Date.now();

    if (
      pageTrackingState.lastSignature === signature &&
      now - pageTrackingState.lastSentAt <= 3000
    ) {
      return;
    }

    pageTrackingState.lastSignature = signature;
    pageTrackingState.lastSentAt = now;

    var routeContext = detectRouteContext(window.location.pathname);

    void fetch(pageTrackingState.apiBaseUrl + "/tickets/page-view", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tradePointId: fallbackTradePointId,
        tradePointName: fallbackTradePointName,
        pageUrl: window.location.href,
        pagePath: pagePath,
        pageTitle: pageTitle,
        pageName: routeContext.pageName,
        routeType: routeContext.routeType,
        entityId: routeContext.entityId || undefined,
        entityName: routeContext.entityName || undefined,
        referrer: document.referrer || undefined,
        timestamp: new Date(now).toISOString(),
        sourceType: "page_view",
      }),
      keepalive: true,
    }).catch(function () {
      return undefined;
    });
  }

  function installPageTracking() {
    if (!pageTrackingState.apiBaseUrl || !fallbackTradePointId) {
      return;
    }

    sendPageView();

    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    history.pushState = function () {
      var result = originalPushState.apply(history, arguments);
      window.setTimeout(sendPageView, 0);
      return result;
    };

    history.replaceState = function () {
      var result = originalReplaceState.apply(history, arguments);
      window.setTimeout(sendPageView, 0);
      return result;
    };

    window.addEventListener("popstate", function () {
      window.setTimeout(sendPageView, 0);
    });
    window.addEventListener("hashchange", function () {
      window.setTimeout(sendPageView, 0);
    });
    window.addEventListener("focus", function () {
      window.setTimeout(sendPageView, 0);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        window.setTimeout(sendPageView, 0);
      }
    });
    window.addEventListener("pageshow", function () {
      window.setTimeout(sendPageView, 0);
    });

    window.setInterval(function () {
      sendPageView();
    }, PAGE_VIEW_HEARTBEAT_INTERVAL_MS);
  }

  var STORAGE_KEY = "touchspace-widget-layout-v2";
  var DEFAULT_PANEL_WIDTH = 336;
  var DEFAULT_PANEL_HEIGHT = 496;
  var MIN_PANEL_WIDTH = 336;
  var MIN_PANEL_HEIGHT = 496;
  var MAX_PANEL_WIDTH = 640;
  var MAX_PANEL_HEIGHT = 820;
  var DESKTOP_GAP = 24;
  var MOBILE_GAP = 12;

  if (fallbackTradePointId) iframeUrl.searchParams.set("tradePointId", String(fallbackTradePointId));
  if (configuredTradePointExternalId) {
    iframeUrl.searchParams.set("tradePointExternalId", String(configuredTradePointExternalId));
  }
  if (fallbackTradePointName) iframeUrl.searchParams.set("tradePointName", String(fallbackTradePointName));
  if (fallbackUserId) iframeUrl.searchParams.set("userId", String(fallbackUserId));
  if (fallbackUserName) iframeUrl.searchParams.set("userName", String(fallbackUserName));
  if (configuredCurrentUserId) {
    iframeUrl.searchParams.set("currentUserId", String(configuredCurrentUserId));
  }
  if (configuredCurrentUserLogin) {
    iframeUrl.searchParams.set("currentUserLogin", String(configuredCurrentUserLogin));
  }
  if (configuredCurrentUserEmail) {
    iframeUrl.searchParams.set("currentUserEmail", String(configuredCurrentUserEmail));
  }
  if (configuredCurrentUserPhone) {
    iframeUrl.searchParams.set("currentUserPhone", String(configuredCurrentUserPhone));
  }
  if (configuredCurrentUserXmlId) {
    iframeUrl.searchParams.set("currentUserXmlId", String(configuredCurrentUserXmlId));
  }
  iframeUrl.searchParams.set("isSuperuser", configuredIsSuperuser ? "true" : "false");
  if (configuredSuperuserId) {
    iframeUrl.searchParams.set("superuserId", String(configuredSuperuserId));
  }
  if (configuredSuperuserEmail) {
    iframeUrl.searchParams.set("superuserEmail", String(configuredSuperuserEmail));
  }
  if (configuredSuperuserPhone) {
    iframeUrl.searchParams.set("superuserPhone", String(configuredSuperuserPhone));
  }
  if (configuredCanonicalEmail) {
    iframeUrl.searchParams.set("canonicalEmail", String(configuredCanonicalEmail));
  }
  if (configuredCanonicalEmailSource) {
    iframeUrl.searchParams.set("canonicalEmailSource", String(configuredCanonicalEmailSource));
  }
  if (configuredUserToken) {
    iframeUrl.searchParams.set("userToken", String(configuredUserToken));
  }
  if (configuredCanonicalEmail) iframeUrl.searchParams.set("email", String(configuredCanonicalEmail));
  if (configuredSuperuserPhone || configuredCurrentUserPhone) {
    iframeUrl.searchParams.set("phone", String(configuredSuperuserPhone || configuredCurrentUserPhone));
  }
  if (config.platform) iframeUrl.searchParams.set("platform", String(config.platform));

  installPageTracking();

  var style = document.createElement("style");
  style.textContent = [
    ".touchspace-widget-root{position:fixed;right:24px;bottom:24px;z-index:2147483000;font-family:Montserrat,ui-sans-serif,system-ui,sans-serif;}",
    ".touchspace-widget-launcher{position:relative;display:inline-flex;align-items:center;justify-content:center;height:85px;width:85px;border:none;border-radius:9999px;background:transparent;cursor:pointer;}",
    ".touchspace-widget-launcher img{display:block;height:85px;width:85px;object-fit:contain;filter:drop-shadow(0 18px 34px rgba(10,132,255,.28));}",
    ".touchspace-widget-launcher.is-pulsing img{animation:touchspace-widget-pulse 1.8s ease-in-out infinite;}",
    ".touchspace-widget-badge{position:absolute;right:6px;top:2px;display:none;min-width:24px;height:24px;padding:0 7px;border-radius:9999px;background:#ff453a;color:#fff;font:600 12px/24px Montserrat,ui-sans-serif,system-ui,sans-serif;box-shadow:0 10px 20px rgba(255,69,58,.35);}",
    ".touchspace-widget-badge.is-visible{display:inline-block;}",
    ".touchspace-widget-panel{display:none;position:fixed;right:24px;bottom:24px;width:336px;height:496px;min-width:336px;min-height:496px;max-width:min(92vw,640px);max-height:min(88vh,820px);border:1px solid #dce3f0;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.18);}",
    ".touchspace-widget-panel.is-open{display:block;}",
    ".touchspace-widget-panel iframe{width:100%;height:100%;border:0;background:#fff;}",
    ".touchspace-widget-close{position:absolute;left:14px;top:14px;z-index:3;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:none;border-radius:9999px;background:rgba(255,255,255,.16);color:#fff;font:400 22px/1 Arial,sans-serif;cursor:pointer;backdrop-filter:blur(3px);box-shadow:0 8px 18px rgba(0,0,0,.14);}",
    ".touchspace-widget-close:hover{background:rgba(255,255,255,.24);}",
    ".touchspace-widget-dragger{position:absolute;left:54px;right:14px;top:0;z-index:3;height:76px;cursor:grab;background:transparent;}",
    ".touchspace-widget-dragger.is-dragging{cursor:grabbing;}",
    ".touchspace-widget-resize{position:absolute;left:8px;bottom:8px;z-index:4;width:20px;height:20px;cursor:nesw-resize;opacity:.82;background:linear-gradient(225deg,transparent 0 42%,#c6d4ee 42% 52%,transparent 52% 64%,#c6d4ee 64% 74%,transparent 74% 86%,#c6d4ee 86% 96%,transparent 96% 100%);}",
    "@keyframes touchspace-widget-pulse{0%{transform:scale(1)}50%{transform:scale(1.08)}100%{transform:scale(1)}}",
    "@media (max-width: 640px){.touchspace-widget-root{right:12px;bottom:12px;left:12px}.touchspace-widget-panel{right:12px;bottom:12px;width:min(336px,calc(100vw - 24px));height:min(496px,78vh);min-width:0;min-height:0;max-width:none;max-height:none}.touchspace-widget-dragger,.touchspace-widget-resize{display:none}.touchspace-widget-launcher{margin-left:auto;display:flex;align-items:center;justify-content:center;}}"
  ].join("");
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.className = "touchspace-widget-root";

  var panel = document.createElement("div");
  panel.className = "touchspace-widget-panel";

  var iframe = document.createElement("iframe");
  iframe.src = iframeUrl.toString();
  iframe.title = "TouchSpace Chat Widget";
  iframe.allow = "clipboard-read; clipboard-write";

  var panelClose = document.createElement("button");
  panelClose.type = "button";
  panelClose.className = "touchspace-widget-close";
  panelClose.setAttribute("aria-label", "Закрыть чат");
  panelClose.textContent = "×";

  var dragHandle = document.createElement("div");
  dragHandle.className = "touchspace-widget-dragger";
  dragHandle.setAttribute("aria-hidden", "true");

  var resizeHandle = document.createElement("span");
  resizeHandle.className = "touchspace-widget-resize";
  resizeHandle.setAttribute("aria-hidden", "true");

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "touchspace-widget-launcher";
  launcher.setAttribute("aria-label", "Открыть чат TouchSpace");

  var launcherImage = document.createElement("img");
  launcherImage.alt = "TouchSpace Chat";
  launcherImage.src = baseUrl + "/icons/robot.svg";

  var badge = document.createElement("span");
  badge.className = "touchspace-widget-badge";

  launcher.appendChild(launcherImage);
  launcher.appendChild(badge);

  function isDesktopLayout() {
    return window.innerWidth > 640;
  }

  function getGap() {
    return isDesktopLayout() ? DESKTOP_GAP : MOBILE_GAP;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeParseLayout() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveLayout(layout) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (_) {
      // noop
    }
  }

  function getViewportBounds() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function getMaxWidth() {
    var viewport = getViewportBounds();
    return clamp(Math.min(MAX_PANEL_WIDTH, viewport.width - getGap() * 2), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
  }

  function getMaxHeight() {
    var viewport = getViewportBounds();
    return clamp(Math.min(MAX_PANEL_HEIGHT, viewport.height - getGap() * 2), MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
  }

  function normalizeLayout(layout) {
    var width = DEFAULT_PANEL_WIDTH;
    var height = DEFAULT_PANEL_HEIGHT;
    var right = getGap();

    if (isDesktopLayout()) {
      var maxWidth = getMaxWidth();
      var maxHeight = getMaxHeight();

      width = clamp(Number(layout && layout.width) || DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, maxWidth);
      height = clamp(Number(layout && layout.height) || DEFAULT_PANEL_HEIGHT, MIN_PANEL_HEIGHT, maxHeight);

      var maxRight = Math.max(getGap(), window.innerWidth - width - getGap());
      right = clamp(Number(layout && layout.right) || getGap(), getGap(), maxRight);
    } else {
      width = Math.min(DEFAULT_PANEL_WIDTH, window.innerWidth - getGap() * 2);
      height = Math.min(DEFAULT_PANEL_HEIGHT, Math.round(window.innerHeight * 0.78));
      right = getGap();
    }

    return {
      width: Math.round(width),
      height: Math.round(height),
      right: Math.round(right),
    };
  }

  function getCurrentLayout() {
    var panelRect = panel.getBoundingClientRect();
    return normalizeLayout({
      width: panelRect.width || parseFloat(panel.style.width) || DEFAULT_PANEL_WIDTH,
      height: panelRect.height || parseFloat(panel.style.height) || DEFAULT_PANEL_HEIGHT,
      right: window.innerWidth - panelRect.right,
    });
  }

  function applyLayout(layout) {
    var normalized = normalizeLayout(layout);

    panel.style.width = normalized.width + "px";
    panel.style.height = normalized.height + "px";
    panel.style.right = normalized.right + "px";
    panel.style.bottom = getGap() + "px";
    panel.style.left = "auto";
  }

  function persistCurrentLayout() {
    if (!isDesktopLayout()) {
      return;
    }

    saveLayout(getCurrentLayout());
  }

  var savedLayout = safeParseLayout();
  applyLayout(savedLayout);

  function setUnreadCount(count) {
    var normalized = Number(count) > 0 ? Number(count) : 0;

    if (normalized > 0) {
      badge.textContent = normalized > 99 ? "99+" : String(normalized);
      badge.classList.add("is-visible");
      launcher.classList.add("is-pulsing");
      return;
    }

    badge.textContent = "";
    badge.classList.remove("is-visible");
    launcher.classList.remove("is-pulsing");
  }

  function postVisibilityState() {
    if (!iframe.contentWindow) {
      return;
    }

    iframe.contentWindow.postMessage(
      {
        type: "touchspace-widget-visibility",
        open: panel.classList.contains("is-open"),
      },
      iframeUrl.origin
    );
  }

  function openWidget() {
    applyLayout(safeParseLayout());
    panel.classList.add("is-open");
    launcher.style.display = "none";
    setUnreadCount(0);
    postVisibilityState();
  }

  function closeWidget() {
    panel.classList.remove("is-open");
    launcher.style.display = "inline-flex";
    postVisibilityState();
  }

  launcher.addEventListener("click", openWidget);
  iframe.addEventListener("load", postVisibilityState);
  panelClose.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    closeWidget();
  });

  var dragState = null;
  var resizeState = null;

  function stopDrag() {
    dragState = null;
    dragHandle.classList.remove("is-dragging");
    if (!resizeState) {
      document.body.style.userSelect = "";
    }
  }

  function stopResize() {
    resizeState = null;
    if (!dragState) {
      document.body.style.userSelect = "";
    }
  }

  dragHandle.addEventListener("pointerdown", function (event) {
    if (!isDesktopLayout() || event.button !== 0) {
      return;
    }

    event.preventDefault();

    var rect = panel.getBoundingClientRect();
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      startRight: window.innerWidth - rect.right,
      startHeight: rect.height,
      width: rect.width,
    };

    dragHandle.classList.add("is-dragging");
    document.body.style.userSelect = "none";
    dragHandle.setPointerCapture(event.pointerId);
  });

  dragHandle.addEventListener("pointermove", function (event) {
    if (!dragState) {
      return;
    }

    event.preventDefault();

    var deltaX = event.clientX - dragState.startX;
    var deltaY = event.clientY - dragState.startY;
    var maxRight = Math.max(getGap(), window.innerWidth - dragState.width - getGap());
    var nextRight = clamp(dragState.startRight - deltaX, getGap(), maxRight);
    var nextHeight = clamp(dragState.startHeight - deltaY, MIN_PANEL_HEIGHT, getMaxHeight());

    panel.style.right = Math.round(nextRight) + "px";
    panel.style.height = Math.round(nextHeight) + "px";
    panel.style.bottom = getGap() + "px";
  });

  dragHandle.addEventListener("pointerup", function (event) {
    if (dragState) {
      dragHandle.releasePointerCapture(event.pointerId);
      persistCurrentLayout();
    }

    stopDrag();
  });

  dragHandle.addEventListener("pointercancel", stopDrag);

  resizeHandle.addEventListener("pointerdown", function (event) {
    if (!isDesktopLayout() || event.button !== 0) {
      return;
    }

    event.preventDefault();

    var rect = panel.getBoundingClientRect();
    resizeState = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startRight: window.innerWidth - rect.right,
      panelLeft: rect.left,
    };

    document.body.style.userSelect = "none";
    resizeHandle.setPointerCapture(event.pointerId);
  });

  resizeHandle.addEventListener("pointermove", function (event) {
    if (!resizeState) {
      return;
    }

    event.preventDefault();

    var deltaX = event.clientX - resizeState.startX;
    var deltaY = event.clientY - resizeState.startY;
    var nextWidth = clamp(resizeState.startWidth - deltaX, MIN_PANEL_WIDTH, getMaxWidth());
    var nextHeight = clamp(resizeState.startHeight + deltaY, MIN_PANEL_HEIGHT, getMaxHeight());
    var nextRight = clamp(
      window.innerWidth - resizeState.panelLeft - nextWidth,
      getGap(),
      Math.max(getGap(), window.innerWidth - nextWidth - getGap())
    );

    panel.style.width = Math.round(nextWidth) + "px";
    panel.style.height = Math.round(nextHeight) + "px";
    panel.style.right = Math.round(nextRight) + "px";
    panel.style.bottom = getGap() + "px";
  });

  resizeHandle.addEventListener("pointerup", function (event) {
    if (resizeState) {
      resizeHandle.releasePointerCapture(event.pointerId);
      persistCurrentLayout();
    }

    stopResize();
  });

  resizeHandle.addEventListener("pointercancel", stopResize);

  if (window.ResizeObserver) {
    var resizeObserver = new window.ResizeObserver(function () {
      if (!isDesktopLayout() || !panel.classList.contains("is-open")) {
        return;
      }

      var layout = getCurrentLayout();
      applyLayout(layout);
      saveLayout(layout);
    });

    resizeObserver.observe(panel);
  }

  window.addEventListener("resize", function () {
    applyLayout(safeParseLayout());
  });

  panel.appendChild(dragHandle);
  panel.appendChild(panelClose);
  panel.appendChild(resizeHandle);
  panel.appendChild(iframe);
  root.appendChild(panel);
  root.appendChild(launcher);
  document.body.appendChild(root);

  window.addEventListener("message", function (event) {
    if (
      event.source !== iframe.contentWindow &&
      event.origin !== iframeUrl.origin
    ) {
      return;
    }

    if (event.data && event.data.type === "touchspace-widget-close") {
      closeWidget();
      return;
    }

    if (event.data && event.data.type === "touchspace-widget-ready") {
      postVisibilityState();
      return;
    }

    if (event.data && event.data.type === "touchspace-widget-sync-page-view") {
      sendPageView();
      return;
    }

    if (event.data && event.data.type === "touchspace-widget-unread") {
      if (!panel.classList.contains("is-open")) {
        setUnreadCount(event.data.unreadCount);
      }
    }
  });

  if (config.autoOpen) {
    openWidget();
  }

  window.TouchSpaceChatWidget = {
    open: openWidget,
    close: closeWidget,
    toggle: function () {
      if (panel.classList.contains("is-open")) {
        closeWidget();
      } else {
        openWidget();
      }
    },
    destroy: function () {
      root.remove();
      style.remove();
      delete window.TouchSpaceChatWidget;
    },
  };
})();
