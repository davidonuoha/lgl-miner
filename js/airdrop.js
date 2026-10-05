/* ==========================================================================
   $LGL Miner — Airdrop screen
   Eligibility tracking and future $LGL distribution information.
   Deliberately invents nothing: no supply, no price, no snapshot date,
   no allocation formula, no claim contract.
   ========================================================================== */

import { CONFIG, rewardLabel } from './config.js';
import { icon } from './icons.js';
import { $, esc, fmtInt, countdownParts } from './ui.js';

export class AirdropView {
  /** @param {import('./store.js').Store} store */
  constructor(store) {
    this.store = store;
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
          <h1 class="h1">Airdrop</h1>
          <p class="subtle">Track eligibility and the future $LGL distribution.</p>
        </div>

        <!-- Points vs tokens disclaimer — required, prominent ------------- -->
        <div class="notice notice--purple" role="note">
          ${icon('info')}
          <div>${esc(CONFIG.disclaimer)}</div>
        </div>

        <!-- $LGL conversion ----------------------------------------------
             Display-only. During the Mining Phase there is no conversion
             and no value attached to LGL Points. No figure is ever derived
             from the points balance here — see _renderConversion(). -->
        <section class="card card--purple" aria-labelledby="conv-heading">
          <div class="card__head">
            ${icon('arrows-clockwise')}
            <h2 class="h2" id="conv-heading">$LGL Conversion</h2>
            <span class="badge badge--purple" id="conv-phase-badge">
              <span class="dot"></span> Mining Phase
            </span>
          </div>

          <div class="conversion" id="conv-block" aria-live="polite"></div>

          <div class="phases" id="conv-phases"></div>
        </section>

        <div class="grid grid--sidebar">
          <div class="stack">

            <!-- $LGL airdrop status -------------------------------------- -->
            <section class="card card--purple" aria-labelledby="airdrop-heading">
              <div class="card__head">
                ${icon('package')}
                <h2 class="h2" id="airdrop-heading">$LGL Airdrop</h2>
                <span class="badge badge--purple">
                  <span class="dot"></span> ${esc(CONFIG.airdrop.status)}
                </span>
              </div>

              <div class="data-list">
                <div class="data-list__row">
                  <span class="data-list__k">Status</span>
                  <span class="data-list__v" id="airdrop-status">${esc(CONFIG.airdrop.status)}</span>
                </div>
                <div class="data-list__row">
                  <span class="data-list__k">Your LGL Points</span>
                  <span class="data-list__v mono" id="info-points">0</span>
                </div>
                <div class="data-list__row">
                  <span class="data-list__k">$LGL Allocation</span>
                  <span class="data-list__v" id="alloc-value">${esc(CONFIG.airdrop.allocation)}</span>
                </div>
                <div class="data-list__row">
                  <span class="data-list__k">Snapshot</span>
                  <span class="data-list__v">${esc(CONFIG.airdrop.snapshot)}</span>
                </div>
                <div class="data-list__row">
                  <span class="data-list__k">Final Allocation</span>
                  <span class="data-list__v" id="final-allocation">${esc(CONFIG.airdrop.finalAllocation)}</span>
                </div>
                <div class="data-list__row">
                  <span class="data-list__k">Target Launch</span>
                  <span class="data-list__v">${esc(CONFIG.launch.label.replace('Target $LGL Token Launch: ', ''))}</span>
                </div>
              </div>

              <p class="subtle tiny" style="margin:14px 0 0">${esc(CONFIG.airdrop.notice)}</p>

              <div class="eligibility" style="margin-top:16px">
                <div class="eligibility__ring" id="elig-ring">${icon('clock')}</div>
                <div>
                  <div class="eyebrow">Eligibility</div>
                  <div class="row" style="margin-top:4px">
                    <span class="badge badge--amber" id="elig-badge">
                      <span class="dot"></span> Not started
                    </span>
                  </div>
                  <p class="tiny muted" style="margin:8px 0 0">
                    Status is provisional until the official snapshot and verification complete.
                  </p>
                </div>
              </div>
            </section>

            <!-- How the airdrop works ------------------------------------ -->
            <section class="card" aria-labelledby="how-heading">
              <div class="card__head">
                ${icon('list-checks')}
                <h2 class="h2" id="how-heading">How the Airdrop Works</h2>
              </div>
              <div class="steps">
                ${[
                  ['Users accumulate LGL Points', 'Points are earned through mining, tasks, bonuses and referrals.'],
                  ['Eligible activity is recorded', 'Activity is logged and reviewed. Not every action automatically qualifies.'],
                  ['An official snapshot is taken', 'A snapshot date will be announced through official channels.'],
                  ['Eligibility is verified', 'Anti-cheat and anti-bot review determines valid participation.'],
                  ['Final allocations are calculated', 'Allocations follow the official airdrop rules.'],
                  ['Claim functionality opens', 'Claim instructions are published after the token launch.'],
                ].map(([t, d], i) => `
                  <div class="step">
                    <span class="step__n">${i + 1}</span>
                    <span class="step__b"><strong>${esc(t)}</strong>${esc(d)}</span>
                  </div>`).join('')}
              </div>
            </section>
          </div>

          <div class="stack">

            <!-- Tokenomics ----------------------------------------------- -->
            <section class="card" aria-labelledby="tokenomics-heading">
              <div class="card__head">
                ${icon('coins')}
                <h2 class="h2" id="tokenomics-heading">Tokenomics</h2>
              </div>
              <div class="empty" style="padding:24px 8px">
                ${icon('coins')}
                <div class="empty__t">Not yet published</div>
                <div class="empty__d">${esc(CONFIG.airdrop.tokenomicsMessage)}</div>
              </div>
              <p class="tiny muted" style="margin:0">
                Supply, distribution and allocation figures will appear here once officially released.
              </p>
            </section>

            <!-- Eligibility checklist ------------------------------------ -->
            <section class="card" aria-labelledby="check-heading">
              <div class="card__head">
                ${icon('seal-check')}
                <h2 class="h2" id="check-heading">Eligible Activity</h2>
              </div>
              <p class="subtle tiny" style="margin:0 0 10px">
                Examples of activity that may count toward eligibility. Final criteria are set by official rules.
              </p>
              <div class="data-list" id="activity-list"></div>
            </section>

            <!-- Launch countdown (mirror) -------------------------------- -->
            <section class="card card--purple" aria-labelledby="cd2-heading">
              <div class="card__head">
                ${icon('target')}
                <h2 class="h2" id="cd2-heading">Target $LGL Launch</h2>
              </div>
              <div class="countdown" role="timer" aria-label="Time until target token launch">
                <div class="countdown__cell"><div class="countdown__n mono" id="acd-days">--</div><div class="countdown__u">Days</div></div>
                <div class="countdown__cell"><div class="countdown__n mono" id="acd-hours">--</div><div class="countdown__u">Hours</div></div>
                <div class="countdown__cell"><div class="countdown__n mono" id="acd-minutes">--</div><div class="countdown__u">Min</div></div>
                <div class="countdown__cell"><div class="countdown__n mono" id="acd-seconds">--</div><div class="countdown__u">Sec</div></div>
              </div>
              <p class="energy__hint">${esc(CONFIG.launch.label)}</p>
              <p class="tiny muted" style="margin:10px 0 0">${esc(CONFIG.launch.disclaimer)}</p>
            </section>
          </div>
        </div>
      </div>`;

    this._refs = {
      points: $('#info-points', root),
      alloc: $('#alloc-value', root),
      eligBadge: $('#elig-badge', root),
      eligRing: $('#elig-ring', root),
      activity: $('#activity-list', root),
      convBlock: $('#conv-block', root),
      convPhases: $('#conv-phases', root),
      convBadge: $('#conv-phase-badge', root),
      finalAllocation: $('#final-allocation', root),
      status: $('#airdrop-status', root),
      cd: {
        days: $('#acd-days', root),
        hours: $('#acd-hours', root),
        minutes: $('#acd-minutes', root),
        seconds: $('#acd-seconds', root),
      },
    };

    this._renderActivity();
    this._renderPhases();
    this._startCountdown();
    this.update();
  }

  destroy() {
    clearInterval(this._cdTimer);
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    this._mounted = false;
  }

  /* ------------------------------------------------------ $LGL conversion
     Renders the conversion block from server-supplied state ONLY.

     There is deliberately no arithmetic here. The frontend must never turn
     a points balance into a $LGL figure — during the Mining Phase the answer
     is simply "Not available yet". A number is shown only when the backend
     sets `allocation.available === true` AND supplies `finalAmount` itself.
     ------------------------------------------------------------------------ */
  _renderConversion() {
    const cfg = CONFIG.conversion;
    const a = this.store.state.allocation || {};
    const block = this._refs.convBlock;
    if (!block) return;

    // Strict: anything other than an explicit server-side `true` stays hidden.
    const available = a.available === true && a.finalAmount !== null && a.finalAmount !== undefined;

    if (!available) {
      block.innerHTML = `
        <span class="eyebrow">Current status</span>
        <span class="conversion__v conversion__v--off" id="conv-value">${esc(cfg.display)}</span>
        <p class="tiny muted conversion__note" id="conv-message">${esc(cfg.message)}</p>`;
      return;
    }

    // Allocation phase, opened by the backend. Figures are printed verbatim.
    block.innerHTML = `
      <div class="conversion__flow">
        <div class="conversion__step">
          <span class="eyebrow">Eligible LGL Points</span>
          <span class="conversion__n mono" id="conv-points">${a.eligiblePoints == null ? '—' : esc(fmtInt(a.eligiblePoints))}</span>
        </div>
        <span class="conversion__arrow" aria-hidden="true">${icon('caret-right')}</span>
        <div class="conversion__step">
          <span class="eyebrow">Final $LGL Allocation</span>
          <span class="conversion__n conversion__n--on mono" id="conv-amount">${esc(fmtInt(a.finalAmount))} $LGL</span>
        </div>
      </div>
      ${a.formulaNote ? `<p class="tiny muted conversion__note">${esc(a.formulaNote)}</p>` : ''}`;
  }

  /** Phase flow: Mining → Snapshot & Allocation → Launch/Claim. */
  _renderPhases() {
    const a = this.store.state.allocation || {};
    const current = a.phase || CONFIG.conversion.phase;
    const idx = CONFIG.conversion.phases.findIndex((p) => p.id === current);

    this._refs.convPhases.innerHTML = CONFIG.conversion.phases
      .map((p, i) => {
        const state = i === idx ? 'current' : i < idx ? 'done' : 'upcoming';
        const tag =
          state === 'current' ? '<span class="phase__tag">Current</span>'
          : state === 'done' ? `<span class="phase__tag phase__tag--done">${icon('check-circle')} Complete</span>`
          : '';
        return `
          <div class="phase phase--${state}" role="listitem">
            <span class="phase__n">${state === 'done' ? icon('check-circle') : i + 1}</span>
            <span class="phase__b">
              <span class="phase__t">${esc(p.label)}${tag}</span>
              <span class="phase__d">${esc(p.detail)}</span>
              ${p.note ? `<span class="phase__note">${esc(p.note)}</span>` : ''}
            </span>
          </div>`;
      })
      .join('');

    const label = CONFIG.conversion.phases[idx]?.label || 'Mining Phase';
    this._refs.convBadge.innerHTML = `<span class="dot"></span> ${esc(label)}`;
  }

  _renderActivity() {
    this._refs.activity.innerHTML = CONFIG.tasks.map((t) => `
      <div class="data-list__row">
        <span class="data-list__k" style="display:flex;align-items:center;gap:9px">
          <span class="task__icon task__icon--${esc(t.accent || 'blue')}"
                style="width:28px;height:28px;border-radius:9px">${icon(t.icon)}</span>
          ${esc(t.title)}
        </span>
        <span class="data-list__v tiny">${esc(rewardLabel(t.reward))}</span>
      </div>`).join('');
  }

  _startCountdown() {
    const tick = () => {
      const parts = countdownParts(new Date(CONFIG.launch.targetISO).getTime() - Date.now());
      const c = this._refs?.cd;
      if (!c?.days) return;
      const pad = (n) => String(n).padStart(2, '0');
      c.days.textContent = String(parts.days);
      c.hours.textContent = pad(parts.hours);
      c.minutes.textContent = pad(parts.minutes);
      c.seconds.textContent = pad(parts.seconds);
    };
    tick();
    this._cdTimer = setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------ rendering */
  update() {
    if (!this._refs) return;
    const s = this.store.state;

    this._refs.points.textContent = fmtInt(s.points);

    // Allocation and conversion stay placeholders until the server reports a
    // real value. Nothing here derives a $LGL figure from the points balance.
    const a = s.allocation || {};
    const open = a.available === true && a.finalAmount != null;
    const allocationText = open ? `${fmtInt(a.finalAmount)} $LGL` : CONFIG.airdrop.allocation;

    this._refs.alloc.textContent = allocationText;
    if (this._refs.finalAllocation) {
      this._refs.finalAllocation.textContent = open
        ? `${fmtInt(a.finalAmount)} $LGL`
        : CONFIG.airdrop.finalAllocation;
    }

    // STATUS reflects the phase the project is actually in.
    const phaseLabel =
      CONFIG.conversion.phases.find((p) => p.id === (a.phase || CONFIG.conversion.phase))?.label ||
      CONFIG.airdrop.status;
    if (this._refs.status) this._refs.status.textContent = phaseLabel;

    // Conversion is display-only and server-driven.
    this._renderConversion();

    // Re-render the phase flow only when the server actually moves phase.
    const phase = a.phase || CONFIG.conversion.phase;
    if (phase !== this._lastPhase) {
      this._lastPhase = phase;
      this._renderPhases();
    }

    // Eligibility is derived from recorded activity, but stays provisional.
    const activityCount =
      (s.totalTaps > 0 ? 1 : 0) +
      (s.referrals.count > 0 ? 1 : 0) +
      (Object.keys(s.tasks.completed || {}).length > 0 ? 1 : 0);

    if (activityCount === 0) {
      this._refs.eligBadge.className = 'badge';
      this._refs.eligBadge.innerHTML = '<span class="dot"></span> Not started';
      this._refs.eligRing.innerHTML = icon('clock');
    } else {
      this._refs.eligBadge.className = 'badge badge--amber';
      this._refs.eligBadge.innerHTML = `<span class="dot"></span> Building`;
      this._refs.eligRing.innerHTML = icon('arrow-clockwise');
    }
  }
}
