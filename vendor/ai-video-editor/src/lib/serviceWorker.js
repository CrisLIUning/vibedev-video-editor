const MODEL_CACHE_WORKER_URL = "/model-cache-sw.js";
let registrationPromise = null;

export function supportsModelCacheServiceWorker(locationLike = globalThis.location) {
  return locationLike?.protocol === "http:" || locationLike?.protocol === "https:";
}

function waitForController() {
  if (navigator.serviceWorker.controller) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 3000);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function registerModelCacheServiceWorker() {
  if (
    !supportsModelCacheServiceWorker()
    || typeof navigator === "undefined"
    || !("serviceWorker" in navigator)
  ) {
    return Promise.resolve(null);
  }

  registrationPromise ??= navigator.serviceWorker
    .register(MODEL_CACHE_WORKER_URL)
    .then(async (registration) => {
      await registration.update().catch(() => {});
      await navigator.serviceWorker.ready;
      await waitForController();
      return registration;
    })
    .catch((error) => {
      console.warn("Model cache service worker registration failed.", error);
      return null;
    });
  return registrationPromise;
}

export function waitForModelCacheServiceWorker() {
  return registerModelCacheServiceWorker();
}
