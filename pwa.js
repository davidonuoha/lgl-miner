/* ==========================================================================
   $LGL Miner — PWA + connectivity
   Service worker registration, install prompt handling and offline state.

   The install CTA is deliberately mobile-only: installing a web app is a
   mobile-first behaviour and the button is hidden on desktop by both JS and
   CSS (`.install-ui-removed`).
   ========================================================================== */

import { $, $$, toast, on } from './ui.js';

const MOBILE_QUERY = '(max-width: 860px)';

export class PwaController {
  constructor() {
    this.deferredPrompt = null;
    this._disposers = [];
    this._installBtns = [];
    this._isMobile = window.matchMedia(MOBILE_QUERY).matches;
  }

  init() {
    this._registerServiceWorker();
    this._wireInstallPrompt();
    this._wireConnectivity();
    this._wireInstallButtons();
    this._reflectDisplayMode();
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
  }

  /* -------------------------------------------------- service worker ---- */
  _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Service workers require a secure context (https or localhost).
    if (!window.isSecureContext) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[pwa] service worker registration failed', err);
      });
    });
  }

  /* ------------------------------------------------ install prompt ------ */
  _wireInstallPrompt() {
    this._disposers.push(on(window, 'beforeinstallprompt', (e) => {
      // Stop the mini-infobar so we can present the CTA on our own terms.
      e.preventDefault();
      this.deferredPrompt = e;
      this._setInstallAvailable(true);
    }));

    this._disposers.push(on(window, 'appinstalled', () => {
      this.deferredPrompt = null;
      this._setInstallAvailable(false);
      toast('App installed. Launch it from your home screen.', 'success');
    }));

    this._disposers.push(on(
      window.matchMedia(MOBILE_QUERY),
      'change',
      (e) => { this._isMobile = e.matches; this._syncButtonVisibility(); },
    ));
  }

  _wireInstallButtons() {
    // Buttons may be re-rendered when views mount, so use delegation.
    this._disposers.push(on(document, 'click', (e) => {
      const btn = e.target.closest('[data-install]');
      if (btn) { this.promptInstall(); return; }

      // The top-bar install button.
      const topBtn = e.target.closest('#install-ui-removed');
      if (topBtn) this.promptInstall();
    }));
  }

  _setInstallAvailable(available) {
    this.installAvailable = available;
    $$('[data-install], #install-ui-removed').forEach((btn) => {
      btn.hidden = !available || !this._isMobile;
    });
  }

  _syncButtonVisibility() {
    const show = this._isMobile && Boolean(this.deferredPrompt);
    $$('#install-ui-removed').forEach((btn) => { btn.hidden = !show; });
    $$('.install-ui-removed').forEach((el) => { el.hidden = !this._isMobile; });
  }

  /**
   * Shows the native install prompt when available, otherwise explains how to
   * install manually. Never shown as a primary CTA on desktop.
   */
  async promptInstall() {
    if (!this.deferredPrompt) {
      toast(
        'Use your browser menu and select "Add to Home screen" when available.',
        'info',
        { duration: 5200 },
      );
      return;
    }

    try {
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      if (outcome === 'accepted') toast('Installing…', 'success');
      this.deferredPrompt = null;
      this._syncButtonVisibility();
    } catch (err) {
      console.warn('[pwa] install prompt failed', err);
      toast('Installation prompt is unavailable right now.', 'warn');
    }
  }

  /** Detects standalone display mode to adjust UI affordances. */
  _reflectDisplayMode() {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    document.documentElement.dataset.displayMode = standalone ? 'standalone' : 'browser';

    if (standalone) {
      $$('.install-ui-removed').forEach((el) => { el.hidden = true; });
      $$('#install-ui-removed').forEach((el) => { el.hidden = true; });
    }
  }

  /* --------------------------------------------------- connectivity ----- */
  _wireConnectivity() {
    const banner = $('#offline-banner');

    const sync = () => {
      const offline = !navigator.onLine;
      document.documentElement.dataset.online = String(!offline);
      if (banner) banner.classList.toggle('is-visible', offline);
    };

    this._disposers.push(on(window, 'online', () => {
      sync();
      toast('Back online.', 'success');
    }));
    this._disposers.push(on(window, 'offline', () => {
      sync();
      toast("You're offline. Some features may be unavailable.", 'warn');
    }));

    sync();
  }
}
