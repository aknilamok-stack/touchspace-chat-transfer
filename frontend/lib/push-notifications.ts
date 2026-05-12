"use client";

import { apiUrl } from "@/lib/api";
import type { AuthSession } from "@/lib/auth";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function getInternalProfileId(session: AuthSession | null) {
  return session?.userId ?? session?.managerId ?? session?.supplierId ?? session?.adminId ?? "";
}

export async function getCurrentPushSubscription() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  return registration.pushManager.getSubscription();
}

export async function getCurrentPushEndpoint() {
  const subscription = await getCurrentPushSubscription();
  return subscription?.endpoint ?? "";
}

export async function enablePushNotifications(session: AuthSession, deviceLabel?: string) {
  const profileId = getInternalProfileId(session);

  if (!profileId || !session.role) {
    throw new Error("Не удалось определить текущего пользователя.");
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Браузер не поддерживает системные уведомления.");
  }

  const nextPermission = await Notification.requestPermission();

  if (nextPermission !== "granted") {
    return {
      permission: nextPermission,
      enabled: false,
    };
  }

  const keyResponse = await fetch(apiUrl("/push/public-key"));
  const keyPayload = (await keyResponse.json()) as { publicKey?: string; configured?: boolean };

  if (!keyPayload?.configured || !keyPayload.publicKey) {
    throw new Error("Web Push пока не настроен на backend. Нужны VAPID-ключи.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyPayload.publicKey),
    });
  }

  const subscriptionJson = subscription.toJSON();

  await fetch(apiUrl("/push/subscriptions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      profileId,
      role: session.role,
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscriptionJson.keys?.p256dh,
        auth: subscriptionJson.keys?.auth,
      },
      userAgent: navigator.userAgent,
      deviceLabel: deviceLabel ?? `${navigator.platform || "desktop"} / ${session.role}`,
    }),
  });

  return {
    permission: nextPermission,
    enabled: true,
    endpoint: subscription.endpoint,
  };
}

export async function unsubscribeCurrentPushSubscription() {
  const subscription = await getCurrentPushSubscription();

  if (!subscription) {
    return { ok: true, endpoint: "" };
  }

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  await fetch(apiUrl("/push/subscriptions"), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      endpoint,
    }),
  });

  return { ok: true, endpoint };
}

export async function sendTestPush(session: AuthSession) {
  const profileId = getInternalProfileId(session);

  if (!profileId || !session.role) {
    throw new Error("Не удалось определить текущего пользователя.");
  }

  await fetch(apiUrl("/push/test"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      profileId,
      role: session.role,
    }),
  });
}

export type InstallPromptHandle = {
  isInstalled: boolean;
  prompt: BeforeInstallPromptEvent | null;
};
