// Browser push subscription helpers. Subscribes this device via the PWA service
// worker and registers it with the API so the server can notify when a video
// finishes processing.

import { api } from "@/lib/api";

export function pushSupported(): boolean {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error("Notifications aren't supported on this device or browser.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  const { publicKey } = await api.get<{ publicKey: string | null }>(
    "/api/push/vapid-key",
  );
  if (!publicKey) throw new Error("Push isn't configured on the server.");

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription() ??
    await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });

  await api.post("/api/push/subscribe", subscription.toJSON());
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;
  await api.post("/api/push/unsubscribe", { endpoint: subscription.endpoint })
    .catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}
