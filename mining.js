/* ==========================================================================
   $LGL Miner — Mining screen
   Tap-to-mine with a logo-backed tap target, per-tap zoom reaction, floating
   point popups, haptics, continuous energy refill and the launch countdown.
   ========================================================================== */

import { CONFIG } from './config.js';
import { icon, logoMark } from './icons.js';
import {
  $, esc, fmtInt, fmtHMS, countdownParts, toast, haptic,
  prefersReducedMotion, on,
} from './ui.js';
import { sfx } from './feedback.js';

export class MiningView {
  /** @param {import('./store.js').Store} store */
  constructor(store, handlers = {}) {
    this.store = store;
    this.handlers = handlers;

    /** Taps accumulated since the last animation frame (rAF-batched). */
    this._pendingTaps = 0;
    this._rafId = null;
    this._logoAnim = null;
    this._disposers = [];
    this._mounted = false;
    this._energyTimer = null;
    this._countdownTimer = null;
  }

  /* ---------------------------------------------------------------- mount */
  mount(root) {
    if (this._mounted) return;
    this._mounted = true;
    this.root = root;

    root.innerHTML = this._template();
    this._refs = {
      minerBtn: $('#miner-btn', root),
      minerLogo: $('#miner-logo', root),
      floatLayer: $('#float-layer', root),
      rate: $('#miner-rate', root),
      energyFill: $('#energy-bar-fill', root),
      energyBar: $('#energy-bar', root),
      energyValue: $('#energy-value', root),
      energyMax: $('#energy-max', root),
      energyHint: $('#energy-hint', root),
      statusBadge: $('#mining-status-badge', root),
      mineConversion: $('#mine-conversion', root),
      minePoints: $('#mine-points', root),
      tilePerTap: $('#tile-per-tap', root),
      tileMultiplier: $('#tile-multiplier', root),
      tileTaps: $('#tile-total-taps', root),
      tileToday: $('#tile-today', root),
      dailyBtn: $('#daily-bonus-btn', root),
      dailyHint: $('#daily-bonus-hint', root),
      adBtn: $('#reward-ad-btn', root),
      adHint: $('#reward-ad-hint', root),
      boostMultiplier: $('#boost-multiplier', root),
      cd: {
        days: $('#cd-days', root),
        hours: $('#cd-hours', root),
        minutes: $('#cd-minutes', root),
        seconds: $('#cd-seconds', root),
      },
      launchDate: $('#launch-date', root),
    };

    this._bind();
    this._startTimers();
    this.update(this.store.state);
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    clearInterval(this._energyTimer);
    clearInterval(this._countdownTimer);
    this._logoAnim?.cancel();
    this._mounted = false;
  }

  /* -------------------------------------------------------------- template */
  _template() {
    const m = CONFIG.mining;
    return `
    <div class="stack">

      <!-- Tap to mine ---------------------------------------------------- -->
      <section class="card card--green" aria-labelledby="miner-heading">
        <div class="card__head">
          ${icon('hammer')}
          <h2 class="h2" id="miner-heading">Tap to Mine</h2>
          <div class="row">
            <span class="badge badge--green" id="mining-status-badge">
              <span class="dot"></span> ACTIVE
            </span>
          </div>
        </div>

        <div class="miner">
          <!-- Floating "+1" popups render here, above the button -->
          <div class="float-layer" id="float-layer" aria-hidden="true"></div>

          <button class="miner__btn" id="miner-btn" type="button"
                  aria-label="Tap to mine LGL Points">
            <!-- Decorative background layer: the official logo. Isolated so its
                 colours can never inherit into, or bleed over, the foreground. -->
            <span class="miner__bg" aria-hidden="true">
              ${logoMark('miner__logo', 'miner-logo')}
            </span>
            <!-- Contrast layer: above the logo, below all foreground content. -->
            <span class="miner__scrim" aria-hidden="true"></span>
            <span class="miner__inner">
              <span class="miner__label">TAP TO MINE</span>
              <span class="miner__rate" id="miner-rate">+${m.perTap} / tap</span>
            </span>
          </button>
        </div>
        <span class="sr-only" aria-live="polite" id="mine-live"></span>

        <!-- Energy -------------------------------------------------------- -->
        <div class="energy">
          <div class="energy__top">
            <span class="energy__label">${icon('lightning')} Energy</span>
            <span class="energy__value">
              <span id="energy-value" class="mono">0</span>
              <span class="mono">/ <span id="energy-max">${m.maxEnergy}</span></span>
            </span>
          </div>
          <div class="bar" id="energy-bar" role="progressbar" aria-label="Energy"
               aria-valuemin="0" aria-valuemax="${m.maxEnergy}" aria-valuenow="0">
            <div class="bar__fill" id="energy-bar-fill"></div>
          </div>
          <p class="energy__hint" id="energy-hint"></p>
        </div>
      </section>

      <!-- LGL Points — phase notice ------------------------------------- -->
      <section class="card card--green" aria-labelledby="points-heading">
        <div class="card__head">
          ${icon('coins')}
          <h2 class="h2" id="points-heading">LGL Points</h2>
          <span class="badge badge--green">
            <span class="dot"></span> ${esc(CONFIG.airdrop.status)}
          </span>
        </div>

        <p class="subtle tiny" style="margin:0 0 14px">${esc(CONFIG.copy.pointsNotice)}</p>

        <div class="data-list">
          <div class="data-list__row">
            <span class="data-list__k">$LGL Conversion</span>
            <span class="data-list__v" id="mine-conversion">${esc(CONFIG.conversion.display)}</span>
          </div>
          <div class="data-list__row">
            <span class="data-list__k">Your LGL Points</span>
            <span class="data-list__v mono" id="mine-points">0</span>
          </div>
        </div>

        <p class="energy__hint">${esc(CONFIG.copy.keepMining)}</p>
      </section>

      <!-- Quick stats ---------------------------------------------------- -->
      <div class="grid grid--4">
        <div class="tile">
          ${icon('hammer')}
          <div class="tile__v" id="tile-per-tap">+1</div>
          <div class="tile__k">Per Tap</div>
        </div>
        <div class="tile">
          ${icon('rocket-launch')}
          <div class="tile__v" id="tile-multiplier">×1</div>
          <div class="tile__k">Multiplier</div>
        </div>
        <div class="tile">
          ${icon('hand-coins')}
          <div class="tile__v mono" id="tile-total-taps">0</div>
          <div class="tile__k">Total Taps</div>
        </div>
        <div class="tile">
          ${icon('calendar-check')}
          <div class="tile__v mono" id="tile-today">0</div>
          <div class="tile__k">Today</div>
        </div>
      </div>

      <div class="grid grid--sidebar">
        <div class="stack">

          <!-- Daily bonus ---------------------------------------------- -->
          <section class="card card--green" aria-labelledby="daily-heading">
            <div class="card__head">
              ${icon('gift')}
              <h2 class="h2" id="daily-heading">Daily Bonus</h2>
            </div>
            <p class="subtle tiny" style="margin:0 0 15px">
              Claim once per calendar day. Resets at midnight.
            </p>
            <button class="btn btn--primary btn--block" id="daily-bonus-btn" type="button">
              ${icon('gift')} Claim +${CONFIG.rewards.dailyBonusPoints} LGL Points
            </button>
            <p class="energy__hint" id="daily-bonus-hint"></p>
          </section>

          <!-- Rewarded ad ---------------------------------------------- -->
          <section class="card card--purple" aria-labelledby="ad-heading">
            <div class="card__head">
              ${icon('play-circle')}
              <h2 class="h2" id="ad-heading">Reward Ad</h2>
            </div>
            <p class="subtle tiny" style="margin:0 0 15px">
              Watch an advertisement to receive a bonus of
              ${CONFIG.rewards.rewardedAdEnergy} energy.
            </p>
            <button class="btn btn--purple btn--block" id="reward-ad-btn" type="button">
              ${icon('play-circle')} Watch Ad
            </button>
            <p class="energy__hint" id="reward-ad-hint"></p>
          </section>
        </div>

        <div class="stack">

          <!-- Mining boost --------------------------------------------- -->
          <section class="card card--blue" aria-labelledby="boost-heading">
            <div class="card__head">
              ${icon('rocket-launch')}
              <h2 class="h2" id="boost-heading">Mining Boost</h2>
            </div>
            <div class="data-list">
              <div class="data-list__row">
                <span class="data-list__k">Current multiplier</span>
                <span class="data-list__v" id="boost-multiplier">×1</span>
              </div>
            </div>
            <p class="subtle tiny" style="margin:12px 0 15px">
              Complete eligible tasks to improve your mining rate.
            </p>
            <button class="btn btn--blue btn--block" type="button" data-go-tasks>
              ${icon('list-checks')} View Tasks
            </button>
          </section>

          <!-- Launch countdown ----------------------------------------- -->
          <section class="card card--purple" aria-labelledby="cd-heading">
            <div class="card__head">
              ${icon('target')}
              <h2 class="h2" id="cd-heading">Target $LGL Launch</h2>
            </div>
            <div class="countdown" role="timer" aria-label="Time until target token launch">
              <div class="countdown__cell"><div class="countdown__n mono" id="cd-days">--</div><div class="countdown__u">Days</div></div>
              <div class="countdown__cell"><div class="countdown__n mono" id="cd-hours">--</div><div class="countdown__u">Hours</div></div>
              <div class="countdown__cell"><div class="countdown__n mono" id="cd-minutes">--</div><div class="countdown__u">Min</div></div>
              <div class="countdown__cell"><div class="countdown__n mono" id="cd-seconds">--</div><div class="countdown__u">Sec</div></div>
            </div>
            <p class="energy__hint" id="launch-date"></p>
            <p class="tiny muted" style="margin:10px 0 0">${esc(CONFIG.launch.disclaimer)}</p>
          </section>
        </div>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------- bindings */
  _bind() {
    const btn = this._refs.minerBtn;

    // pointerdown fires sooner than click → the tap feels instant.
    const onPress = (e) => {
      if (btn.disabled) {
        toast('Not enough energy. Wait for the refill.', 'warn');
        return;
      }
      if (e.cancelable) e.preventDefault();
      this._handleTap(e);
    };

    this._disposers.push(on(btn, 'pointerdown', onPress));
    // Keyboard activation (Space/Enter) for accessibility.
    this._disposers.push(on(btn, 'keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this._handleTap(e); }
    }));
    // Suppress the synthetic click that follows pointerdown on touch devices.
    this._disposers.push(on(btn, 'click', (e) => e.preventDefault()));
    // Guard against pinch-zoom on the miner.
    this._disposers.push(on(btn, 'touchstart', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false }));

    this._disposers.push(on(this._refs.dailyBtn, 'click', () => this._claimDaily()));
    this._disposers.push(on(this._refs.adBtn, 'click', () => this.handlers.onOpenRewardedAd?.()));

    const goTasks = $('[data-go-tasks]', this.root);
    if (goTasks) this._disposers.push(on(goTasks, 'click', () => this.handlers.onGoTasks?.()));
  }

  /* ------------------------------------------------------------ tap engine */
  /**
   * Runs the immediate, tactile feedback for a single tap and queues the
   * authoritative store update for the next animation frame.
   *
   * Feedback is fired per tap (that is what makes it feel responsive); the
   * store call is batched so rapid tapping only touches the DOM once a frame.
   */
  _handleTap(e) {
    const point = this._pointFromEvent(e);

    this._pressLogo();
    this._spawnFloat(point.x, point.y);
    this._spawnRipple(e);

    if (this.store.state.settings.haptics) haptic(CONFIG.feedback.hapticMs);
    sfx.tap();

    this._pendingTaps += 1;
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      const count = this._pendingTaps;
      this._pendingTaps = 0;
      this._flushTaps(count);
    });
  }

  /** Point relative to the float layer, falling back to the button centre. */
  _pointFromEvent(e) {
    const layer = this._refs.floatLayer;
    const rect = layer.getBoundingClientRect();

    const hasPointer =
      e && typeof e.clientX === 'number' && typeof e.clientY === 'number' &&
      (e.clientX !== 0 || e.clientY !== 0);

    if (!hasPointer) return { x: rect.width / 2, y: rect.height / 2 };

    // Keep popups inside the layer so they never create scrollbars.
    const clampAxis = (value, size) => {
      if (!size) return 0;
      const lo = Math.min(16, size / 2);
      const hi = Math.max(lo, size - 16);
      return Math.min(Math.max(value, lo), hi);
    };

    return {
      x: clampAxis(e.clientX - rect.left, rect.width),
      y: clampAxis(e.clientY - rect.top, rect.height),
    };
  }

  /**
   * The logo "reacts" to the tap: it snaps in and springs back.
   * Uses the Web Animations API so it runs on the compositor and never forces
   * a synchronous layout, which matters when tapping 15+ times a second.
   */
  _pressLogo() {
    const logo = this._refs.minerLogo;
    if (!logo || prefersReducedMotion() || typeof logo.animate !== 'function') return;

    this._logoAnim?.cancel();
    this._logoAnim = logo.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.83)', offset: 0.32 },
        { transform: 'scale(1.06)', offset: 0.68 },
        { transform: 'scale(1)' },
      ],
      { duration: CONFIG.feedback.logoPressMs, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' },
    );
  }

  /** Expanding ring at the tap point, clipped inside the button. */
  _spawnRipple(e) {
    if (prefersReducedMotion()) return;
    const btn = this._refs.minerBtn;
    const rect = btn.getBoundingClientRect();

    const hasPointer =
      e && typeof e.clientX === 'number' && (e.clientX !== 0 || e.clientY !== 0);

    const clampAxis = (value, size) => {
      if (!size) return 0;
      const lo = Math.min(10, size / 2);
      const hi = Math.max(lo, size - 10);
      return Math.min(Math.max(value, lo), hi);
    };

    const x = hasPointer ? clampAxis(e.clientX - rect.left, rect.width) : rect.width / 2;
    const y = hasPointer ? clampAxis(e.clientY - rect.top, rect.height) : rect.height / 2;

    const el = document.createElement('span');
    el.className = 'ripple';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    btn.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }

  /** Floating "+N" popup, Hamster-Kombat style. */
  _spawnFloat(x, y, text) {
    if (prefersReducedMotion()) return;
    const layer = this._refs.floatLayer;
    if (!layer) return;

    const rate = CONFIG.mining.perTap * this.store.state.multiplier;
    const el = document.createElement('span');
    el.className = 'float';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--float-ms', `${CONFIG.feedback.floatDurationMs}ms`);
    el.textContent = text ?? `+${fmtInt(rate)}`;

    layer.appendChild(el);
    setTimeout(() => el.remove(), CONFIG.feedback.floatDurationMs + 120);
  }

  async _flushTaps(count) {
    const result = await this.store.tap(count);

    if (!result.ok) {
      this.update(this.store.state);
      if (result.error === 'no-energy') {
        toast('Not enough energy.', 'warn');
        sfx.warn();
      } else {
        toast(result.message || "We couldn't process that mining action. Please try again.", 'error');
        sfx.error();
      }
      return;
    }

    this.update(this.store.state);
    const live = $('#mine-live', this.root);
    if (live) live.textContent = `${fmtInt(this.store.state.points)} LGL Points`;
  }

  /* ------------------------------------------------------------- timers */
  _startTimers() {
    // Drives energy refill, the refill countdown and the hint text.
    // `tick()` advances the refill clock so the tank keeps filling while the
    // user is idle — without it energy would only move on the next tap.
    this._energyTimer = setInterval(() => {
      this.store.tick?.();
      this.update(this.store.state);
    }, 1000);

    this._tickCountdown();
    this._countdownTimer = setInterval(() => this._tickCountdown(), 1000);
  }

  _tickCountdown() {
    const parts = countdownParts(new Date(CONFIG.launch.targetISO).getTime() - Date.now());
    const c = this._refs.cd;
    if (!c?.days) return;

    const pad = (n) => String(n).padStart(2, '0');
    c.days.textContent = String(parts.days);
    c.hours.textContent = pad(parts.hours);
    c.minutes.textContent = pad(parts.minutes);
    c.seconds.textContent = pad(parts.seconds);

    if (this._refs.launchDate) this._refs.launchDate.textContent = CONFIG.launch.label;
  }

  /* ------------------------------------------------------------ rendering */
  update(state) {
    if (!this._refs) return;
    const m = CONFIG.mining;

    // ---- LGL Points / $LGL conversion --------------------------------
    // Display-only. The conversion figure comes from the server; nothing here
    // derives a $LGL amount from the points balance.
    if (this._refs.minePoints) this._refs.minePoints.textContent = fmtInt(state.points);
    if (this._refs.mineConversion) {
      const a = state.allocation || {};
      this._refs.mineConversion.textContent =
        a.available === true && a.finalAmount != null
          ? `${fmtInt(a.finalAmount)} $LGL`
          : CONFIG.conversion.display;
    }

    // ---- Energy ------------------------------------------------------
    const energy = Math.floor(state.energy);
    const pct = Math.min(100, (state.energy / m.maxEnergy) * 100);
    this._refs.energyFill.style.width = `${pct}%`;
    this._refs.energyBar.setAttribute('aria-valuenow', String(energy));
    this._refs.energyValue.textContent = fmtInt(energy);
    if (this._refs.energyMax) this._refs.energyMax.textContent = fmtInt(m.maxEnergy);

    const empty = state.energy < m.energyPerTap;
    const toFull = this.store.secondsToFullRefill?.() ?? 0;
    const hint = this._refs.energyHint;

    if (empty) {
      hint.className = 'energy__hint is-low';
      hint.innerHTML = `${icon('clock')} Not enough energy. Full refill in <strong>${fmtHMS(toFull)}</strong>.`;
    } else if (toFull > 0) {
      hint.className = 'energy__hint';
      hint.innerHTML = `${icon('arrow-clockwise')} Full refill in <strong>${fmtHMS(toFull)}</strong> · +1 every ${(m.energyRefillSeconds / m.maxEnergy).toFixed(1)}s`;
    } else {
      hint.className = 'energy__hint';
      hint.innerHTML = `${icon('check-circle')} Energy full.`;
    }

    // ---- Tap target --------------------------------------------------
    this._refs.minerBtn.disabled = empty;
    this._refs.minerBtn.setAttribute('aria-disabled', String(empty));
    const rate = m.perTap * state.multiplier;
    this._refs.rate.textContent = `+${fmtInt(rate)} / tap`;

    const status = empty ? 'RECHARGING' : 'ACTIVE';
    this._refs.statusBadge.className = `badge ${empty ? 'badge--amber' : 'badge--green'}`;
    this._refs.statusBadge.innerHTML = `<span class="dot"></span> ${status}`;

    // ---- Stats -------------------------------------------------------
    this._refs.tilePerTap.textContent = `+${fmtInt(rate)}`;
    this._refs.tileMultiplier.textContent = `×${state.multiplier}`;
    this._refs.tileTaps.textContent = fmtInt(state.totalTaps);
    this._refs.tileToday.textContent = fmtInt(state.today?.pointsEarned ?? 0);
    this._refs.boostMultiplier.textContent = `×${state.multiplier}`;

    // ---- Daily bonus -------------------------------------------------
    const claimedToday = state.dailyBonus.lastClaimedDate === todayKey();
    this._refs.dailyBtn.disabled = claimedToday;
    this._refs.dailyBtn.innerHTML = claimedToday
      ? `${icon('check-circle')} Claimed`
      : `${icon('gift')} Claim +${CONFIG.rewards.dailyBonusPoints} LGL Points`;
    this._refs.dailyHint.textContent = claimedToday ? 'Come back tomorrow for the next bonus.' : '';

    // ---- Rewarded ad -------------------------------------------------
    const adDone = state.tasks.watchedAdToday;
    this._refs.adBtn.disabled = adDone;
    this._refs.adBtn.innerHTML = adDone
      ? `${icon('check-circle')} Reward claimed`
      : `${icon('play-circle')} Watch Ad`;
    this._refs.adHint.textContent = adDone
      ? 'Available again tomorrow.'
      : 'Demo reward — replace with a real ad provider integration.';
  }

  /* --------------------------------------------------------------- actions */
  async _claimDaily() {
    const res = await this.store.claimDailyBonus();
    if (!res.ok) {
      toast(res.message || 'Daily bonus already claimed.', 'warn');
      sfx.warn();
    } else {
      toast(res.message || `+${CONFIG.rewards.dailyBonusPoints} LGL Points earned.`, 'success');
      if (this.store.state.settings.haptics) haptic(CONFIG.feedback.hapticClaimMs);
      sfx.success();
      this._spawnFloat(
        this._refs.floatLayer.getBoundingClientRect().width / 2,
        this._refs.floatLayer.getBoundingClientRect().height / 2,
        `+${CONFIG.rewards.dailyBonusPoints}`,
      );
    }
    this.update(this.store.state);
  }
}

/* Local helper — avoids importing the store just for a date key. */
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
