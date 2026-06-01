'use client';

/**
 * Minimal Google Maps JS API loader (no extra dependency). Injects the script
 * once and resolves when `window.google.maps` is ready. Falls back to a no-op
 * when no browser key is configured (the page renders a list-only view).
 */

let loadPromise: Promise<typeof google | null> | null = null;

export function loadGoogleMaps(): Promise<typeof google | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (loadPromise) return loadPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) {
    loadPromise = Promise.resolve(null);
    return loadPromise;
  }

  loadPromise = new Promise<typeof google | null>((resolve) => {
    if (window.google?.maps) {
      resolve(window.google);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loadPromise;
}
