/* ==========================================================================
   $LGL Miner — Android package builder
   --------------------------------------------------------------------------
   Turns the deployed PWA into a downloadable Android package using the
   PWABuilder cloud packager (the same service pwabuilder.com uses).

     POST https://pwabuilder-cloudapk.azurewebsites.net/generateAppPackage
     → ZIP containing <name>.apk (and a .aab for Google Play)

   Notes
     · The service fetches the live site, so this only works once the app is
       deployed to a public HTTPS URL. It cannot build from localhost.
     · `signingMode: 'none'` returns an UNSIGNED apk — fine for testing and
       for sideloading after re-signing, or upload the .aab to Google Play
       (Play signs it for you). Set `android.signing` in js/config.js to
       produce a signed build.
   ========================================================================== */

import { CONFIG } from './config.js';
import { extractFirst } from './zip.js';

const manifestUrl = () => new URL('manifest.json', document.baseURI).href;
const startUrl = () => new URL('./', document.baseURI).href;

/** Resolves a path against the deployed app root. */
function abs(path) {
  return new URL(path, document.baseURI).href;
}

function slugify(value) {
  return String(value || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'app';
}

/** Picks the icon closest to 512px from the manifest, with a safe fallback. */
function pickIcon(manifest) {
  const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
  const sized = icons
    .filter((i) => i && i.src)
    .map((i) => ({ src: i.src, size: parseInt(String(i.sizes || '').split('x')[0], 10) || 0 }))
    .sort((a, b) => Math.abs(b.size - 512) - Math.abs(a.size - 512));
  if (sized[0]?.src) {
    try { return new URL(sized[0].src, manifestUrl()).href; } catch { /* fall through */ }
  }
  return abs(CONFIG.android.iconPath);
}

/** Builds the exact request body the packager expects. */
export function buildAndroidPayload({ manifest = {}, iconUrl } = {}) {
  const cfg = CONFIG.android;
  const theme = cfg.themeColor || '#000000';
  const background = cfg.backgroundColor || theme;
  const name = manifest.name || manifest.short_name || CONFIG.app.name;
  const launcher = manifest.short_name || CONFIG.app.shortName || name;

  return {
    additionalTrustedOrigins: [],
    analysisId: null,
    appVersion: cfg.appVersion,
    appVersionCode: cfg.appVersionCode,
    backgroundColor: background,
    display: manifest.display === 'fullscreen' ? 'fullscreen' : 'standalone',
    enableNotifications: false,
    enableSiteSettingsShortcut: true,
    fallbackType: 'customtabs',
    features: {
      locationDelegation: { enabled: false },
      playBilling: { enabled: false },
    },
    host: location.origin,
    iconUrl: iconUrl || abs(cfg.iconPath),
    includeSourceCode: false,
    isChromeOSOnly: false,
    launcherName: launcher,
    maskableIconUrl: null,
    monochromeIconUrl: null,
    name,
    navigationColor: background,
    navigationColorDark: background,
    navigationDividerColor: background,
    navigationDividerColorDark: background,
    orientation: 'portrait',
    packageId: cfg.packageId,
    pwaUrl: startUrl(),
    serviceAccountJsonFile: null,
    shareTarget: null,
    shortcuts: [],
    signing: cfg.signing || null,
    signingMode: cfg.signing ? 'existing' : 'none',
    splashScreenFadeOutDuration: 300,
    startUrl: startUrl(),
    themeColor: theme,
    themeColorDark: theme,
    webManifestUrl: manifestUrl(),
  };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Turns an error response body into a readable one-liner. */
function readableError(text, status) {
  const raw = String(text || '').trim();
  if (!raw) return `The packager returned ${status}. Please try again.`;
  if (/Invalid PWA settings/i.test(raw)) return raw.replace(/\s+/g, ' ').slice(0, 200);
  if (/<!doctype|<html/i.test(raw)) {
    return `The packager could not build this app (HTTP ${status}). The site must be deployed and reachable over HTTPS.`;
  }
  return raw.replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Generates the Android package and downloads it.
 *
 * @param {{onStatus?: (msg: string) => void}} [options]
 * @returns {Promise<{ok: boolean, filename?: string, kind?: 'apk'|'zip', message?: string}>}
 */
export async function generateAndroidPackage({ onStatus = () => {} } = {}) {
  const cfg = CONFIG.android;

  if (location.protocol === 'file:') {
    return { ok: false, message: 'Open the deployed site (https://) to build an APK — it cannot be generated from a local file.' };
  }

  onStatus('Reading the app manifest…');
  let manifest = {};
  try {
    const res = await fetch(manifestUrl(), { cache: 'no-store' });
    if (res.ok) manifest = await res.json();
  } catch { /* use defaults */ }

  const payload = buildAndroidPayload({ manifest, iconUrl: pickIcon(manifest) });
  const baseName = slugify(manifest.name || CONFIG.app.name);

  onStatus('Building the Android package… this can take up to a minute.');

  let res;
  try {
    res = await fetch(cfg.packagerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[android] packager unreachable', err);
    return {
      ok: false,
      message: 'Could not reach the Android packager. Check your connection, then try again.',
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, message: readableError(text, res.status) };
  }

  const buffer = await res.arrayBuffer();
  if (!buffer.byteLength) return { ok: false, message: 'The packager returned an empty package.' };

  onStatus('Unpacking the APK…');
  let apk = null;
  try {
    apk = await extractFirst(buffer, (name) => name.toLowerCase().endsWith('.apk'));
  } catch (err) {
    console.warn('[android] could not unpack, delivering the zip', err);
  }

  if (apk) {
    triggerDownload(new Blob([apk.bytes], { type: 'application/vnd.android.package-archive' }), `${baseName}.apk`);
    return { ok: true, filename: `${baseName}.apk`, kind: 'apk' };
  }

  // Fallback: hand back the whole package (contains the .apk and the .aab).
  triggerDownload(new Blob([buffer], { type: 'application/zip' }), `${baseName}-android.zip`);
  return { ok: true, filename: `${baseName}-android.zip`, kind: 'zip' };
}
