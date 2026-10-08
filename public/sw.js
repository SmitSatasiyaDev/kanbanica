self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    (async () => {
      // Drop stale popups. If a device is offline for a while, the push service
      // queues undelivered pushes and dumps them all on reconnect — we don't want
      // a burst of old notifications popping up. `ttlMs` mirrors the server's
      // PUSH_TTL_SECONDS, so the cutoff here always matches the send-side TTL.
      // The notification is still saved server-side (Inbox + badge); only the
      // popup is suppressed.
      const staleMs = data.ttlMs ?? 10 * 60 * 1000; // fallback for old payloads
      if (data.sentAt && Date.now() - data.sentAt > staleMs) {
        const isDev =
          self.location.hostname === "localhost" ||
          self.location.hostname === "127.0.0.1";
        if (isDev) {
          console.debug("[sw] dropped stale push", {
            ageMs: Date.now() - data.sentAt,
            staleMs,
          });
        }
        return;
      }

      // Avoid double popups: if a Kanbanica window is focused, the app shows an
      // in-app toast instead, so suppress the browser/desktop notification here.
      // When no window is focused (hidden tab, minimized, unfocused, or app
      // closed), show the browser notification. The Inbox is saved server-side
      // regardless — this only affects the popup.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = clients.some((c) => c.focused);
      if (focused) {
        return;
      }

      await self.registration.showNotification(data.title ?? "Kanbanica", {
        body: data.body ?? "",
        icon: "/icon-192.png?v=2",
        badge: "/icon-192.png?v=2",
        data: { url: data.url ?? "/" },
        requireInteraction: false,
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer an existing tab: focus it AND navigate it to the notification's
      // target. The URL already includes /[workspaceId]/..., so navigating also
      // switches the app into the correct workspace. Focusing alone would leave
      // the tab on whatever page it was already showing.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // Detached/uncontrolled client — fall through to a new window.
              if (self.clients.openWindow) {
                await self.clients.openWindow(url);
              }
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })()
  );
});
