// Web Push handlers, imported into the Workbox-generated service worker.
// Shows a notification when the server pushes one, and focuses/opens the app
// at the target URL when it's clicked.
/* eslint-disable no-undef */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Vidura";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Your video is ready.",
      icon: "/vidura-icon.svg",
      badge: "/vidura-icon.svg",
      tag: data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
