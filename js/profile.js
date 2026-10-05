/* ==========================================================================
   $LGL Miner — Profile screen
   Account info, wallet state, mining statistics, settings, help and legal.
   ========================================================================== */

import { CONFIG } from './config.js';
import { icon } from './icons.js';
import { $, $$, esc, fmtInt, toast, on } from './ui.js';
import { generateAndroidPackage } from './android.js';

export class ProfileView {
  /**
   * @param {import('./store.js').Store} store
   * @param {{ onOpenAbout: () => void, onOpenInstall: () => void, onOpenFaq: () => void,
   *           onOpenTerms: () => void, onOpenPrivacy: () => void }} handlers
   */
  constructor(store, handlers = {}) {
    this.store = store;
    this.handlers = handlers;
    this._disposers = [];
    this._mounted = false;
  }

  mount(root) {
    if (this._mounted) return;
    this._mounted = true;
    this.root = root;

    root.innerHTML = `
      <div class="stack">
        <div class="view__head">
          <h1 class="h1">Profile</h1>
          <p class="subtle">Your account, wallet status and mining statistics.</p>
        </div>

        <!-- Account ------------------------------------------------------ -->
        <section class="card card--flush card--cyan" aria-labelledby="acct-heading">
          <div class="profile-head">
            <div class="avatar">${icon('user')}</div>
            <div style="min-width:0;flex:1">
              <h2 class="h2" id="acct-heading"><span id="acct-name">Lagos Miner</span></h2>
              <p class="tiny muted" style="margin:2px 0 0" id="acct-email">—</p>
              <p class="tiny muted" style="margin:2px 0 0" id="acct-meta">Member since —</p>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" id="signout-btn">
              ${icon('sign-out')} Sign out
            </button>
          </div>
        </section>

        <div class="grid grid--sidebar">
          <div class="stack">

            <!-- Mining statistics ---------------------------------------- -->
            <section class="card" aria-labelledby="mstats-heading">
              <div class="card__head">
                ${icon('chart-line-up')}
                <h2 class="h2" id="mstats-heading">Mining Statistics</h2>
              </div>
              <div class="grid grid--2">
                <div class="stat">
                  <span class="stat__k">LGL Points</span>
                  <span class="stat__v mono" id="p-points">0</span>
                </div>
                <div class="stat">
                  <span class="stat__k">Total Taps</span>
                  <span class="stat__v mono" id="p-taps">0</span>
                </div>
                <div class="stat">
                  <span class="stat__k">Multiplier</span>
                  <span class="stat__v" id="p-mult">×1</span>
                </div>
                <div class="stat">
                  <span class="stat__k">Energy</span>
                  <span class="stat__v mono" id="p-energy">0</span>
                </div>
              </div>
            </section>

            <!-- Wallet ---------------------------------------------------- -->
            <section class="card card--cyan" aria-labelledby="wallet-heading">
              <div class="card__head">
                ${icon('wallet')}
                <h2 class="h2" id="wallet-heading">Wallet</h2>
                <div class="row"><span class="badge badge--cyan" id="wallet-badge">
                  <span class="dot"></span> Not connected
                </span></div>
              </div>

              <div class="notice notice--blue">
                ${icon('info')}
                <div>
                  <strong>Connect when the claim phase opens.</strong><br>
                  ${esc(CONFIG.copy.walletNotice)}<br>
                  No wallet connection is required to earn LGL Points, and connecting
                  one does not mean you have received $LGL. Never share your seed
                  phrase or private keys with anyone.
                </div>
              </div>

              <button class="btn btn--cyan btn--block" type="button" id="wallet-btn" disabled aria-disabled="true"
                      style="margin-top:14px">
                ${icon('wallet')} Connect Wallet
              </button>
              <p class="energy__hint">Not available yet — opens at the claim phase.</p>
            </section>

            <!-- Installation --------------------------------------------- -->
            <!-- Android app (APK) ------------------------------------- -->
            <section class="card" id="android-card" aria-labelledby="android-heading">
              <div class="card__head">
                ${icon('download-simple')}
                <h2 class="h2" id="android-heading">Android App</h2>
                <div class="row"><span class="badge badge--green">APK</span></div>
              </div>
              <p class="subtle tiny" style="margin:0 0 12px" id="android-note">
                Build and download the Android package from this site. It is generated
                on demand and can take up to a minute.
              </p>
              <button class="btn btn--primary" type="button" id="apk-download">
                ${icon('download-simple')} Download Android App (.apk)
              </button>
              <p class="tiny muted" id="apk-status" role="status" aria-live="polite" style="margin:10px 0 0"></p>
            </section>
          </div>

          <div class="stack">

            <!-- Settings -------------------------------------------------- -->
            <section class="card card--flush" aria-labelledby="settings-heading">
              <div class="card__head" style="padding:var(--sp-5) var(--sp-5) 0;margin-bottom:var(--sp-3)">
                ${icon('gear')}
                <h2 class="h2" id="settings-heading">Settings</h2>
              </div>
              <div class="menu-list">
                <label class="menu-item" for="set-haptics">
                  ${icon('sparkle')}
                  <span class="menu-item__t">
                    Haptic feedback
                    <span class="menu-item__d" style="display:block">Vibrate slightly on each tap.</span>
                  </span>
                  <input type="checkbox" id="set-haptics" data-setting="haptics">
                </label>
                <label class="menu-item" for="set-sound">
                  ${icon('sparkle')}
                  <span class="menu-item__t">
                    Sound effects
                    <span class="menu-item__d" style="display:block">Play a short sound on taps and rewards.</span>
                  </span>
                  <input type="checkbox" id="set-sound" data-setting="sound">
                </label>
                <label class="menu-item" for="set-notifications">
                  ${icon('megaphone')}
                  <span class="menu-item__t">
                    In-app notifications
                    <span class="menu-item__d" style="display:block">Show reward and status toasts.</span>
                  </span>
                  <input type="checkbox" id="set-notifications" data-setting="notifications">
                </label>
              </div>
            </section>

            <!-- Info & legal --------------------------------------------- -->
            <section class="card card--flush" aria-labelledby="more-heading">
              <div class="card__head" style="padding:var(--sp-5) var(--sp-5) 0;margin-bottom:var(--sp-3)">
                ${icon('info')}
                <h2 class="h2" id="more-heading">Information</h2>
              </div>
              <div class="menu-list">
                <button class="menu-item" type="button" id="open-about">
                  ${icon('info')}<span class="menu-item__t">About Project</span>${icon('caret-right', 'chev')}
                </button>
                <button class="menu-item" type="button" id="open-faq">
                  ${icon('question')}<span class="menu-item__t">Help / FAQ</span>${icon('caret-right', 'chev')}
                </button>
                <button class="menu-item" type="button" id="open-terms">
                  ${icon('file-text')}<span class="menu-item__t">Terms</span>${icon('caret-right', 'chev')}
                </button>
                <button class="menu-item" type="button" id="open-privacy">
                  ${icon('lock')}<span class="menu-item__t">Privacy</span>${icon('caret-right', 'chev')}
                </button>
              </div>
            </section>

            <!-- Danger zone ---------------------------------------------- -->
            <section class="card" aria-labelledby="data-heading">
              <div class="card__head">
                ${icon('warning-circle')}
                <h2 class="h2" id="data-heading">Local Data</h2>
              </div>
              <p class="subtle tiny" style="margin:0 0 14px">
                This prototype stores your progress in this browser only. Clearing
                it permanently erases the local demo balance.
              </p>
              <button class="btn btn--danger btn--block" type="button" id="reset-data">
                ${icon('arrow-clockwise')} Reset local progress
              </button>
            </section>
          </div>
        </div>
      </div>`;

    this._refs = {
      name: $('#acct-name', root),
      email: $('#acct-email', root),
      meta: $('#acct-meta', root),
      points: $('#p-points', root),
      taps: $('#p-taps', root),
      mult: $('#p-mult', root),
      energy: $('#p-energy', root),
      walletBadge: $('#wallet-badge', root),
      haptics: $('#set-haptics', root),
      sound: $('#set-sound', root),
      notifications: $('#set-notifications', root),
    };

    this._bind();
    this.update();
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    this._mounted = false;
  }

  _bind() {
    const h = this.handlers;

    this._disposers.push(on($('#open-about', this.root), 'click', () => h.onOpenAbout?.()));
    this._disposers.push(on($('#open-faq', this.root), 'click', () => h.onOpenFaq?.()));
    this._disposers.push(on($('#open-terms', this.root), 'click', () => h.onOpenTerms?.()));
    this._disposers.push(on($('#open-privacy', this.root), 'click', () => h.onOpenPrivacy?.()));
    this._disposers.push(on($('#apk-download', this.root), 'click', () => this._downloadApk()));

    this._disposers.push(on(this._refs.haptics, 'change', (e) =>
      this.store.updateSettings({ haptics: e.target.checked })));

    this._disposers.push(on(this._refs.sound, 'change', (e) =>
      this.store.updateSettings({ sound: e.target.checked })));

    this._disposers.push(on(this._refs.notifications, 'change', (e) =>
      this.store.updateSettings({ notifications: e.target.checked })));

    this._disposers.push(on($('#signout-btn', this.root), 'click', () => h.onSignOut?.()));

    this._disposers.push(on($('#reset-data', this.root), 'click', async () => {
      const ok = window.confirm(
        'Reset local progress?\n\nThis erases your points, taps, energy and task history stored in this browser. It cannot be undone.',
      );
      if (!ok) return;
      await this.store.reset();
      toast('Local progress reset.', 'info');
      this.update();
    }));
  }

  /* ------------------------------------------------------------ rendering */
  update() {
    if (!this._refs) return;
    const s = this.store.state;

    this._refs.name.textContent = s.user.handle || 'Lagos Miner';
    if (this._refs.email) {
      this._refs.email.textContent = s.user.email || 'Not signed in';
    }
    this._refs.meta.textContent = `Member since ${new Date(s.user.createdAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })}`;

    this._refs.points.textContent = fmtInt(s.points);
    this._refs.taps.textContent = fmtInt(s.totalTaps);
    this._refs.mult.textContent = `×${s.multiplier}`;
    this._refs.energy.textContent = `${Math.floor(s.energy)} / ${CONFIG.mining.maxEnergy}`;

    this._refs.walletBadge.className = s.wallet.connected
      ? 'badge badge--green'
      : 'badge badge--cyan';
    this._refs.walletBadge.innerHTML = `<span class="dot"></span> ${
      s.wallet.connected ? 'Connected' : 'Not connected'
    }`;

    this._refs.haptics.checked = Boolean(s.settings.haptics);
    this._refs.sound.checked = Boolean(s.settings.sound);
    this._refs.notifications.checked = Boolean(s.settings.notifications);
  }
  /** Builds the Android package on demand and downloads it. */
  async _downloadApk() {
    const btn = $('#apk-download', this.root);
    const status = $('#apk-status', this.root);
    if (btn?.disabled) return;

    const setStatus = (msg) => { if (status) status.textContent = msg; };
    if (btn) btn.disabled = true;
    setStatus('Preparing…');

    try {
      const res = await generateAndroidPackage({ onStatus: setStatus });
      if (res.ok) {
        setStatus(res.kind === 'apk'
          ? `Done — ${res.filename} downloaded.`
          : `Done — ${res.filename} downloaded (contains the .apk and .aab).`);
        toast('Android package downloaded.', 'success');
      } else {
        setStatus(res.message || 'Could not build the Android package.');
        toast('Could not build the APK.', 'warn');
      }
    } catch (err) {
      console.error('[profile] apk failed', err);
      setStatus('Could not build the Android package. Please try again.');
      toast('Could not build the APK.', 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

}
