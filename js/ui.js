/* ==========================================================================
   $LGL Miner — Shared UI primitives
   Toasts, navigation, modals, formatting and small DOM helpers.
   ========================================================================== */

import { icon } from './icons.js';

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapes text before it is placed into innerHTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attaches a listener and returns a disposer. */
export function on(el, type, handler, opts) {
  el.addEventListener(type, handler, opts);
  return () => el.removeEventListener(type, handler, opts);
}

/* --------------------------------------------------------------------------
   Formatters
   -------------------------------------------------------------------------- */
const numberFmt = new Intl.NumberFormat('en-US');

/** 125480 -> "125,480" */
export const fmtInt = (n) => numberFmt.format(Math.max(0, Math.round(Number(n) || 0)));

/** Compact form for leaderboards: 84200 -> "84,200" (kept exact, not 84.2K). */
export const fmtPoints = (n) => fmtInt(n);

/** Seconds -> "MM:SS" */
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Seconds -> "H:MM:SS" above an hour, "MM:SS" below it.
 * Used for the energy refill countdown (a full tank takes one hour).
 */
export function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Milliseconds -> {d,h,m,s} parts for the launch countdown. */
export function countdownParts(msRemaining) {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** "March 1, 2027" from an ISO string, in UTC. */
export function fmtDateUTC(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */
const TOAST_ICON = {
  success: 'check-circle',
  info: 'info',
  warn: 'warning-circle',
  error: 'warning-circle',
};

let toastHost = null;
const MAX_TOASTS = 3;

/**
 * Shows a transient notification.
 * @param {string} message
 * @param {'success'|'info'|'warn'|'error'} [tone]
 * @param {{ duration?: number }} [opts]
 */
export function toast(message, tone = 'info', opts = {}) {
  if (!toastHost) toastHost = $('#toasts');
  if (!toastHost) return;

  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(TOAST_ICON[tone] || 'info')}<div class="toast__b"><div class="toast__m">${esc(message)}</div></div>`;

  toastHost.appendChild(el);

  // Keep the stack small so it never covers the navigation.
  while (toastHost.children.length > MAX_TOASTS) {
    toastHost.removeChild(toastHost.firstElementChild);
  }

  const duration = opts.duration ?? (tone === 'error' ? 4200 : 2600);
  const dismiss = () => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Safety net if animations are disabled by reduced-motion.
    setTimeout(() => el.remove(), 400);
  };
  setTimeout(dismiss, duration);
  return dismiss;
}

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */
export const VIEWS = ['mine', 'airdrop', 'tasks', 'friends', 'profile'];
export const VIEW_TITLES = {
  mine: 'Mine',
  airdrop: 'Airdrop',
  tasks: 'Tasks',
  friends: 'Friends',
  profile: 'Profile',
};

let activeView = 'mine';
const viewListeners = new Set();

export const getActiveView = () => activeView;
export const onViewChange = (fn) => { viewListeners.add(fn); return () => viewListeners.delete(fn); };

/**
 * Switches the visible section.
 * @param {string} view  One of VIEWS.
 * @param {{ updateHash?: boolean }} [opts]
 */
export function navigate(view, opts = {}) {
  if (!VIEWS.includes(view)) view = 'mine';
  activeView = view;

  $$('.view').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.view === view);
  });

  $$('[data-nav]').forEach((el) => {
    const isCurrent = el.dataset.view === view;
    if (isCurrent) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });

  const title = $('[data-topbar-title]');
  if (title) title.textContent = VIEW_TITLES[view];

  if (opts.updateHash !== false && location.hash.slice(1) !== view) {
    // history.replaceState avoids polluting the back stack on every tab tap.
    history.replaceState(null, '', `#${view}`);
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
  for (const fn of viewListeners) fn(view);
}

/** Reads `#view` from the URL, if present. */
export function viewFromHash() {
  const raw = location.hash.slice(1);
  return VIEWS.includes(raw) ? raw : null;
}

/* --------------------------------------------------------------------------
   Modal
   -------------------------------------------------------------------------- */
let lastFocused = null;

/** Opens a modal by element id. Traps focus and restores it on close. */
export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocused = document.activeElement;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  const focusable = $$(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    modal,
  );
  (focusable[0] || modal).focus?.();
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lastFocused?.focus?.();
  lastFocused = null;
}

export function closeAllModals() {
  $$('.modal.is-open').forEach((m) => closeModal(m.id));
}

/**
 * Wires up every `[data-close-modal]` button and scrim click, plus Escape
 * and a simple focus trap. Call once at boot.
 */
export function initModals() {
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close-modal]');
    if (closer) { closeModal(closer.closest('.modal')?.id); return; }
    if (e.target.classList.contains('modal__scrim')) {
      closeModal(e.target.closest('.modal')?.id);
    }
  });

  document.addEventListener('keydown', (e) => {
    const open = $('.modal.is-open');
    if (!open) return;

    if (e.key === 'Escape') { closeModal(open.id); return; }

    if (e.key === 'Tab') {
      const focusable = $$(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        open,
      ).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

/* --------------------------------------------------------------------------
   Accordion (FAQ)
   -------------------------------------------------------------------------- */
export function initAccordion() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accordion]');
    if (!btn) return;
    const item = btn.closest('.faq__item');
    const isOpen = item.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(isOpen));
  });
}

/* --------------------------------------------------------------------------
   Clipboard & share (with graceful fallbacks)
   -------------------------------------------------------------------------- */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:absolute;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Native share sheet where supported, clipboard otherwise.
 * @returns {Promise<'shared'|'copied'|'failed'>}
 */
export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      // AbortError = user dismissed the sheet; not a failure worth reporting.
      if (err?.name === 'AbortError') return 'shared';
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

/* --------------------------------------------------------------------------
   Haptics (best-effort, silently ignored where unsupported)
   -------------------------------------------------------------------------- */
export function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

/* --------------------------------------------------------------------------
   Reduced-motion preference
   -------------------------------------------------------------------------- */
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* --------------------------------------------------------------------------
   Rendering helper for empty states
   -------------------------------------------------------------------------- */
export function emptyState(iconName, title, description, actionHtml = '') {
  return `
    <div class="empty">
      ${icon(iconName)}
      <div class="empty__t">${esc(title)}</div>
      <div class="empty__d">${esc(description)}</div>
      ${actionHtml}
    </div>`;
}
