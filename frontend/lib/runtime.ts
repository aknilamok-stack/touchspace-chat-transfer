export type DesktopRuntimeMeta = {
  isDesktopShell: boolean;
  isPackaged: boolean;
  platform: string;
  startUrl?: string;
};

export type DesktopShellNotificationPayload = {
  title: string;
  body?: string;
  url?: string;
  ticketId?: string;
  scopeStatus?: string;
  subtitle?: string | null;
  metaLabel?: string | null;
  primaryLabel?: string;
  secondaryLabel?: string;
  header?: string;
  messageId?: string;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
  tone?: "green" | "amber" | "blue";
};

declare global {
  interface Window {
    touchspaceDesktop?: {
      isDesktopShell: boolean;
      isPackaged: boolean;
      platform: string;
      getMeta: () => Promise<DesktopRuntimeMeta>;
      openExternal: (url: string) => Promise<boolean>;
      showNotification?: (payload: DesktopShellNotificationPayload) => Promise<boolean>;
      clipboard?: {
        readText: () => string;
        writeText: (value: string) => boolean;
      };
      authStorage?: {
        get: () => string | null;
        set: (rawValue: string) => boolean;
        clear: () => boolean;
      };
    };
  }
}

export const isDesktopShell = () =>
  typeof window !== "undefined" && Boolean(window.touchspaceDesktop?.isDesktopShell);

export const readDesktopRuntimeMeta = async (): Promise<DesktopRuntimeMeta | null> => {
  if (typeof window === "undefined" || !window.touchspaceDesktop) {
    return null;
  }

  try {
    return await window.touchspaceDesktop.getMeta();
  } catch {
    return {
      isDesktopShell: true,
      isPackaged: false,
      platform: "unknown",
    };
  }
};

export const showDesktopShellNotification = async (
  payload: DesktopShellNotificationPayload,
) => {
  if (typeof window === "undefined" || !window.touchspaceDesktop?.showNotification) {
    return false;
  }

  try {
    return await window.touchspaceDesktop.showNotification(payload);
  } catch {
    return false;
  }
};

export const shouldShowDesktopBackgroundNotification = () => {
  if (!isDesktopShell() || typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }

  return document.visibilityState !== "visible" || !document.hasFocus();
};
