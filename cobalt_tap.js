(() => {
  if (window.__cobaltCanineTapInstalled) return;
  window.__cobaltCanineTapInstalled = true;

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const reqUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const method = (args[1]?.method || args[0]?.method || "GET").toUpperCase();
      if (method === "POST" && reqUrl.includes("canine.tools")) {
        const clone = response.clone();
        clone.json().then((data) => {
          if (data && typeof data === "object" && data.status) {
            window.postMessage(
              { source: "cobalt-canine-tap", payload: data },
              "*"
            );
          }
        }).catch(() => {});
      }
    } catch {}
    return response;
  };
})();
