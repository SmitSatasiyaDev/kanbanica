/** Mirrors view state into the URL (no navigation, no server call) so a refresh keeps it. */
export function setUrlParams(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) {
      url.searchParams.delete(k);
    } else {
      url.searchParams.set(k, v);
    }
  }
  window.history.replaceState(window.history.state, "", url);
}
