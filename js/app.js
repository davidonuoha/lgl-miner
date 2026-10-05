/* ==========================================================================
   $LGL Miner — Application bootstrap
   Wires the store, views, navigation, modals and PWA controller together.
   ========================================================================== */

import { CONFIG } from './config.js';
import { hydrateIcons, icon } from './icons.js';
import { LocalStore } from './store.js';
import {
  $, $$, esc, toast, navigate, viewFromHash, initModals, initAccordion,
  openModal, closeModal, on, haptic, fmtInt,
} from './ui.js';
import { MiningView } from './mining.js';
import { TasksView } from './tasks.js';
import { ReferralsView } from './referrals.js';
import { AirdropView } from './airdrop.js';
import { ProfileView } from './profile.js';
import { PwaController } from './pwa.js';
import { AuthView } from './auth.js';
import { AdminCenter } from './admin.js';
import { sfx, setEnabled as setSoundEnabled, unlock as unlockAudio } from './feedback.js';

/* --------------------------------------------------------------------------
   Ad provider seam
   --------------------------------------------------------------------------
   The prototype simulates a rewarded ad. To go live, implement `showAd` with
   a real provider (AdMob/AdSense rewarded, Unity Ads, etc.) and return the
   provider's server-side verification token. The reward is only credited
   after the backend validates that token — never on the client's word.

     const adProvider = {
       async showAd() {
         const result = await window.SomeAdSdk.showRewarded();
         return { completed: result.completed, providerToken: result.ssvToken };
       },
     };
   -------------------------------------------------------------------------- */
const adProvider = {
  /** @returns {Promise<{completed: boolean, providerToken: string|null}>} */
  async showAd({ onProgress } = {}) {
    // Simulated 5-second "ad". Replace the whole body with a real SDK call.
    const seconds = 5;
    for (let i = seconds; i > 0; i -= 1) {
      onProgress?.(i, seconds);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { completed: true, providerToken: 'DEMO-TOKEN' };
  },
};

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
class App {
  constructor() {
    // Swap to `new ApiStore({ baseUrl: '/api' })` when the backend is live.
    this.store = new LocalStore();
    this.pwa = new PwaController();
    this.views = {};
    this._adRunning = false;
    this._entered = false;
    this.admin = null;
  }

  async start() {
    // Must run before any view mounts so `data-icon` / `data-logo` placeholders
    // in the static shell are filled in.
    hydrateIcons();

    await this.store.init();

    // Wire everything that lives outside the signed-in shell first, so the
    // auth screen still gets modals, PWA install and audio unlock.
    this._wireNavigation();
    this._wireModals();
    this._wireGlobalGuards();
    this._unlockAudioOnFirstGesture();
    this._wireAuth();
    this._wireAdmin();
    initModals();
    initAccordion();
    this.pwa.init();

    // Re-render dependent views whenever state changes. Subscribed once, for
    // the lifetime of the page, so sign-in/out never double-subscribes.
    this.store.subscribe((state) => this._onStateChange(state));

    // Session gate: the app shell (and the mine screen) only opens when a
    // valid session exists.
    if (this.store.isAuthenticated()) this._enterApp();
    else this._showAuth();

    this._hideBootLoader();
  }

  /* --------------------------------------------------------------- auth -- */
  _wireAuth() {
    const root = document.getElementById('auth-screen');
    if (!root) return;
    this.authView = new AuthView(this.store, {
      onAuthenticated: () => this._enterApp(),
    });
    this.authView.mount(root);
  }

  /**
   * Mounts the Admin Center overlay and wires the top-bar Admin button.
   * The overlay is inert until an admin passcode is accepted.
   */
  _wireAdmin() {
    const root = document.getElementById('admin-screen');
    const btn = document.getElementById('topbar-admin');
    if (!root) return;

    this.admin = new AdminCenter({ playerStore: this.store });
    this.admin.mount(root);
    // Load the persisted admin state in the background; the store notifies us.
    this.admin.init();

    if (btn) btn.addEventListener('click', () => this.admin.toggle());
  }

  _showAuth() {
    document.body.classList.add('is-locked');
    const root = document.getElementById('auth-screen');
    if (root) {
      root.hidden = false;
      root.classList.add('is-active');
    }
    this.authView?.focusFirst?.();
  }

  /** Reveals the app shell and mounts the signed-in user's views. */
  _enterApp() {
    document.body.classList.remove('is-locked');
    const root = document.getElementById('auth-screen');
    if (root) {
      root.hidden = true;
      root.classList.remove('is-active');
    }

    if (!this._entered) {
      this._entered = true;
      this._mountViews();
      this._renderStaticContent();
      this._applyIncomingReferral();
      navigate(viewFromHash() || 'mine');
    }

    this._updateTopBar(this.store.state);
    this._onStateChange(this.store.state);
  }

  /** Tears down the signed-in views so a later account starts clean. */
  _teardownViews() {
    for (const view of Object.values(this.views)) view.destroy?.();
    this.views = {};
    this._entered = false;
    document.querySelectorAll('.view').forEach((el) => { el.innerHTML = ''; });
  }

  async _signOut() {
    this._teardownViews();
    await this.store.signOut();
    toast('Signed out.', 'info');
    this._showAuth();
  }

  /* --------------------------------------------------------- top bar ---- */
  /**
   * The LGL Points balance lives in the top bar, so it is visible on every
   * screen without a large dedicated card.
   */
  _updateTopBar(state) {
    const el = $('#topbar-balance');
    if (!el) return;

    const next = fmtInt(state.points);
    if (el.textContent === next) return;

    el.textContent = next;
    if (this._firstBalancePaint) {
      const pill = $('#balance-pill');
      if (pill) {
        pill.classList.remove('is-bumped');
        // Restart the bump animation.
        void pill.offsetWidth;
        pill.classList.add('is-bumped');
      }
    }
    this._firstBalancePaint = true;
  }

  /* -------------------------------------------------------------- views */
  _mountViews() {
    const handlers = {
      onGoTasks: () => navigate('tasks'),
      onGoFriends: () => navigate('friends'),
      onOpenRewardedAd: () => this._openRewardedAd(),
      onOpenAbout: () => openModal('modal-about'),
      onOpenFaq: () => openModal('modal-faq'),
      onOpenTerms: () => openModal('modal-terms'),
      onOpenPrivacy: () => openModal('modal-privacy'),
      onOpenInstall: () => this.pwa.promptInstall(),
      onSignOut: () => this._signOut(),
    };

    const specs = [
      ['mine', MiningView, { onOpenRewardedAd: handlers.onOpenRewardedAd, onGoTasks: handlers.onGoTasks }],
      ['airdrop', AirdropView, {}],
      ['tasks', TasksView, { onOpenRewardedAd: handlers.onOpenRewardedAd, onGoFriends: handlers.onGoFriends }],
      ['friends', ReferralsView, {}],
      ['profile', ProfileView, handlers],
    ];

    for (const [name, ViewClass, opts] of specs) {
      const root = document.getElementById(`view-${name}`);
      if (!root) continue;
      const view = new ViewClass(this.store, opts);
      view.mount(root);
      this.views[name] = view;
    }
  }

  _onStateChange(state) {
    // Keep the audio layer in sync with the user's setting.
    setSoundEnabled(state.settings?.sound !== false);

    this._updateTopBar(state);
    this.views.mine?.update(state);
    this.views.airdrop?.update(state);
    this.views.profile?.update(state);
    this.views.friends?.update(state);
    this.views.tasks?.update(state);
  }

  /* --------------------------------------------------------- navigation */
  _wireNavigation() {
    document.addEventListener('click', (e) => {
      const navEl = e.target.closest('[data-nav]');
      if (!navEl) return;
      e.preventDefault();
      navigate(navEl.dataset.view);
    });

    // Browser back/forward between hash sections.
    window.addEventListener('hashchange', () => {
      const v = viewFromHash();
      if (v) navigate(v, { updateHash: false });
    });
  }

  /* ------------------------------------------------------------ modals */
  _wireModals() {
    const aboutBtn = $('#topbar-about');
    if (aboutBtn) on(aboutBtn, 'click', () => openModal('modal-about'));

    // Rewarded-ad modal controls
    const watchBtn = $('#ad-start');
    if (watchBtn) on(watchBtn, 'click', () => this._runAd());
  }

  /* ----------------------------------------------------- static content */
  _renderStaticContent() {
    // FAQ
    const faqList = $('#faq-list');
    if (faqList) {
      faqList.innerHTML = CONFIG.faq.map((item, i) => `
        <div class="faq__item">
          <button class="faq__q" type="button" data-accordion
                  aria-expanded="false" aria-controls="faq-a-${i}">
            ${esc(item.q)}
            ${icon('caret-right', 'chev')}
          </button>
          <div class="faq__a" id="faq-a-${i}" role="region">${esc(item.a)}</div>
        </div>`).join('');
    }

    // Roadmap
    const roadmap = $('#roadmap-list');
    if (roadmap) {
      roadmap.innerHTML = CONFIG.roadmap.map((step) => `
        <div class="roadmap__item roadmap__item--${esc(step.tone || 'base')}">
          <div class="roadmap__rail">
            <span class="roadmap__dot"></span>
            <span class="roadmap__line"></span>
          </div>
          <div class="roadmap__b">
            <div class="roadmap__when">${esc(step.when)}</div>
            <div class="roadmap__what">${esc(step.what)}</div>
            <div class="roadmap__list">
              ${step.items.map((it) => `<span>${esc(it)}</span>`).join('')}
            </div>
          </div>
        </div>`).join('');
    }

    // Tokenomics placeholder inside About
    const tok = $('#about-tokenomics');
    if (tok) tok.textContent = CONFIG.airdrop.tokenomicsMessage;

    // About $LGL Miner — the relationship between the miner, LGL Points, $LGL
    // and the Lagos Life ecosystem. Paragraphs come from config so the wording
    // stays identical wherever it appears.
    const aboutMiner = $('#about-miner');
    if (aboutMiner) {
      aboutMiner.innerHTML = CONFIG.copy.aboutMiner
        .split('\n\n')
        .map((para) => `<span class="about-para">${esc(para)}</span>`)
        .join('');
    }

    // The canonical long-form disclaimer, rendered verbatim.
    const aboutDisclaimer = $('#about-disclaimer');
    if (aboutDisclaimer) {
      aboutDisclaimer.innerHTML =
        `<strong>Disclaimer.</strong> ${esc(CONFIG.legalDisclaimer)}`;
    }
    const termsDisclaimer = $('#terms-disclaimer');
    if (termsDisclaimer) {
      termsDisclaimer.innerHTML =
        `<strong>Disclaimer.</strong> ${esc(CONFIG.legalDisclaimer)}`;
    }

    // $LGL conversion status inside About — server-driven, never computed.
    const conv = $('#about-conversion');
    if (conv) {
      const a = this.store.state.allocation || {};
      const open = a.available === true && a.finalAmount != null;
      conv.textContent = open
        ? `Allocation phase is open. Your eligible LGL Points are ${fmtInt(a.eligiblePoints)} ` +
          `and your final allocation is ${fmtInt(a.finalAmount)} $LGL.`
        : `${CONFIG.conversion.display}. ${CONFIG.copy.pointsNotice}`;
    }

    // Launch date — every date shown in the shell derives from
    // CONFIG.launch.targetISO, so changing it in one place updates all of them.
    $$('[data-launch-label]').forEach((el) => { el.textContent = CONFIG.launch.label; });
    $$('[data-launch-date]').forEach((el) => { el.textContent = CONFIG.launch.dateLabel; });

    // Terms / privacy "last updated"
    $$('[data-build-version]').forEach((el) => { el.textContent = 'v1.0.0'; });
  }

  /* ------------------------------------------------------- referral link */
  async _applyIncomingReferral() {
    const params = new URLSearchParams(location.search);
    const code = params.get(CONFIG.app.refParam);
    if (!code) return;

    // The code came from an invite link, so it is applied automatically and
    // the manual entry field is locked out for this account.
    const res = await this.store.applyReferral(code, { source: 'link' });
    if (res.ok && res.message) {
      toast(res.message, 'success');
    } else if (res.error === 'self-referral') {
      toast('You cannot refer yourself.', 'warn');
      sfx.warn();
    } else if (res.error === 'already-applied') {
      toast('A referral code is already linked to this account.', 'info');
    }
    // Clean the URL so a refresh does not re-submit the code.
    params.delete(CONFIG.app.refParam);
    const qs = params.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);

    // Tell the Friends screen the link attempt is finished. If it succeeded the
    // field stays locked (a referral is one-time); if it failed, the user is
    // free to type a different code.
    this.views.friends?.onIncomingReferralSettled?.();
  }

  /* --------------------------------------------------- rewarded ad flow */
  _openRewardedAd() {
    if (this.store.state.tasks.watchedAdToday) {
      toast('Reward already claimed today.', 'warn');
      sfx.warn();
      return;
    }
    this._resetAdModal();
    // Invalidate any ad run that was in flight when the modal was last closed.
    this._adRunId = (this._adRunId || 0) + 1;
    openModal('modal-ad');
  }

  _resetAdModal() {
    const stage = $('#ad-stage');
    const startBtn = $('#ad-start');
    const claimBtn = $('#ad-claim');
    const status = $('#ad-status');
    if (!stage) return;

    stage.innerHTML = `
      <div style="display:grid;place-items:center;gap:10px;padding:28px 12px;color:var(--text-2)">
        ${icon('play-circle')}
        <div style="font-weight:600;color:var(--text)">Simulated advertisement</div>
        <p class="tiny muted" style="margin:0;text-align:center;max-width:340px">
          This demo stands in for a real rewarded-ad provider. No advertisement
          is shown and no advertiser is involved.
        </p>
      </div>`;
    startBtn.hidden = false;
    startBtn.disabled = false;
    // Always restore the label — a previous run leaves it as "Playing…".
    startBtn.innerHTML = `${icon('play-circle')} Watch Ad`;
    claimBtn.hidden = true;
    claimBtn.disabled = false;
    status.textContent = `Reward: +${CONFIG.rewards.rewardedAdEnergy} energy.`;
  }

  async _runAd() {
    if (this._adRunning) return;
    this._adRunning = true;

    // Generation counter: if the modal is closed and reopened while a
    // simulated ad is still "playing", the stale run must not touch the UI.
    const runId = (this._adRunId = (this._adRunId || 0) + 1);

    const startBtn = $('#ad-start');
    const claimBtn = $('#ad-claim');
    const status = $('#ad-status');
    startBtn.disabled = true;

    try {
      const result = await adProvider.showAd({
        onProgress: (remaining) => {
          if (this._adRunId !== runId) return;
          status.textContent = `Playing… ${remaining}s`;
          startBtn.innerHTML = `${icon('clock')} Playing…`;
        },
      });

      // The user closed the modal mid-play — discard the result.
      if (this._adRunId !== runId) return;

      if (!result.completed) {
        status.textContent = 'The advertisement was not completed. No reward was granted.';
        startBtn.hidden = false;
        startBtn.disabled = false;
        startBtn.innerHTML = `${icon('play-circle')} Watch Ad`;
        return;
      }

      // Production: send result.providerToken to the backend, which verifies it
      // with the ad network before granting anything.
      status.textContent = 'Advertisement complete. Claim your reward.';
      startBtn.hidden = true;
      claimBtn.hidden = false;
      claimBtn.focus();
    } catch (err) {
      console.error('[ad] failed', err);
      if (this._adRunId === runId) {
        status.textContent = "We couldn't process that reward. Please try again.";
        startBtn.disabled = false;
        startBtn.innerHTML = `${icon('play-circle')} Watch Ad`;
      }
    } finally {
      this._adRunning = false;
    }
  }

  async _claimAdReward() {
    const res = await this.store.claimRewardedAd();
    if (!res.ok) {
      toast(res.message || 'Reward already claimed today.', 'warn');
      sfx.warn();
    } else {
      toast(res.message || `+${CONFIG.rewards.rewardedAdEnergy} energy reward.`, 'success');
      haptic(16);
      sfx.reward();
    }
    closeModal('modal-ad');
  }

  /* ------------------------------------------------------------ audio -- */
  /**
   * Browsers keep an AudioContext suspended until a real user gesture.
   * Resume it on the first pointerdown/keydown, then stop listening — the
   * context stays unlocked for the rest of the session.
   */
  _unlockAudioOnFirstGesture() {
    const unlock = () => {
      unlockAudio();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
  }

  /* ------------------------------------------------------ global guards */
  _wireGlobalGuards() {
    // Rewarded-ad claim button lives in the modal markup; bind it here.
    const claimBtn = $('#ad-claim');
    if (claimBtn) on(claimBtn, 'click', () => this._claimAdReward());

    // Flush pending writes before the page is discarded.
    window.addEventListener('pagehide', () => this.store.flush?.());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.store.flush?.();
    });

    // Never let a runtime error blank the interface silently.
    window.addEventListener('error', (e) => {
      console.error('[app] uncaught error', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('[app] unhandled rejection', e.reason);
    });

    // Keyboard shortcuts: 1–5 jump between sections.
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
      if (idx >= 0) navigate(['mine', 'airdrop', 'tasks', 'friends', 'profile'][idx]);
    });
  }

  _hideBootLoader() {
    const boot = $('#boot');
    if (boot) {
      boot.classList.add('is-hidden');
      setTimeout(() => boot.remove(), 300);
    }
    document.body.classList.remove('is-booting');
  }
}

/* --------------------------------------------------------------------------
   Entry
   -------------------------------------------------------------------------- */
function main() {
  const app = new App();
  window.__lgl = app; // useful for debugging and end-to-end tests

  app.start().catch((err) => {
    console.error('[app] failed to start', err);
    const boot = $('#boot');
    if (boot) {
      boot.innerHTML = `
        <div style="max-width:420px;text-align:center;padding:24px">
          <div style="font-weight:700;margin-bottom:8px">Something went wrong. Please try again.</div>
          <p style="color:#B6B6BE;font-size:13px;margin:0 0 16px">
            The application could not start. Reload the page to retry.
          </p>
          <button class="btn btn--primary" type="button" id="boot-reload">Reload</button>
        </div>`;
      // The strict CSP (script-src 'self') blocks inline handlers, so bind the
      // reload button with a real listener instead of an onclick attribute.
      boot.querySelector('#boot-reload')?.addEventListener('click', () => location.reload());
    }
    document.body.classList.remove('is-booting');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

export { App };
