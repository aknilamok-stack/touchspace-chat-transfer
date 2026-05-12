"use client";

let notificationAudio: HTMLAudioElement | null = null;

function getNotificationAudio() {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }

  if (!notificationAudio) {
    notificationAudio = new Audio("/sounds/notification.mp3");
    notificationAudio.preload = "auto";
  }

  return notificationAudio;
}

export function playNotificationSound() {
  const audio = getNotificationAudio();

  if (!audio) {
    return;
  }

  try {
    audio.pause();
    audio.currentTime = 0;
    const playPromise = audio.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        console.error("Не удалось воспроизвести звук уведомления:", error);
      });
    }
  } catch (error) {
    console.error("Не удалось воспроизвести звук уведомления:", error);
  }
}
