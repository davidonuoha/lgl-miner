/* ==========================================================================
   $LGL Miner — Friends / Referral screen
   Displays the referral code, share controls, referral count and a clearly
   labelled demo leaderboard.

   Anti-abuse: the frontend NEVER decides whether a referral is valid and
   never credits a reward for one. It renders whatever the server reports.
   ========================================================================== */

import { CONFIG, referralUrl } from './config.js';
import { DEMO_LEADERBOARD } from './store.js';
import { icon } from './icons.js';
import {
  $, esc, fmtInt, fmtPoints, toast, copyText, shareText, emptyState, on,
} from './ui.js';
import { sfx } from './feedback.js';

export class ReferralsView {
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
          <h1 class="h1">Friends</h1>
          <p class="subtle">Invite new miners. Referral rewards are credited after server-side verification.</p>
        </div>

        <div class="notice notice--orange">
          ${icon('info')}
          <div>
            <strong>Referral rewards.</strong>
            ${esc(CONFIG.copy.referralNotice)}
          </div>
        </div>

        <div class="grid grid--sidebar">
          <div class="stack">

            <!-- Referral code ------------------------------------------ -->
            <section class="card card--orange" aria-labelledby="ref-heading">
              <div class="card__head">
                ${icon('users')}
                <h2 class="h2" id="ref-heading">Your Referral Code</h2>
              </div>

              <div class="refcode">
                <div class="refcode__value mono" id="ref-code" aria-label="Your referral code">—</div>
              </div>

              <div class="reflink" style="margin-top:14px">
                ${icon('link')}
                <code id="ref-url">—</code>
              </div>

              <div class="row wrap" style="margin-top:14px">
                <button class="btn btn--orange" type="button" id="copy-link">
                  ${icon('copy')} Copy Link
                </button>
                <button class="btn btn--outline-orange" type="button" id="share-link">
                  ${icon('share-network')} Share
                </button>
              </div>

              <p class="energy__hint" id="ref-hint">
                Share your link. Each verified new miner counts toward your referral total.
              </p>
            </section>

            <!-- Redeem an invite code ---------------------------------- -->
            <section class="card card--purple" aria-labelledby="redeem-heading">
              <div class="card__head">
                ${icon('gift')}
                <h2 class="h2" id="redeem-heading">Have an Invite Code?</h2>
                <div class="row"><span class="badge badge--purple">One-time</span></div>
              </div>

              <p class="subtle tiny" style="margin:0 0 12px">
                If a friend invited you, enter their referral code to link your
                account. It can only be applied <strong>once</strong> and cannot be changed later.
              </p>

              <form class="refapply" id="ref-form" novalidate>
                <label class="field refapply__field" for="ref-input">
                  <span class="field__label">Referral code</span>
                  <span class="field__wrap">
                    ${icon('gift')}
                    <input class="field__input" id="ref-input" name="referral" type="text"
                           autocomplete="off" autocapitalize="characters" spellcheck="false"
                           maxlength="24" placeholder="e.g. LGL-AB12"
                           aria-describedby="ref-apply-status">
                  </span>
                </label>
                <button class="btn btn--primary" type="submit" id="ref-apply">
                  ${icon('seal-check')} Apply Code
                </button>
              </form>

              <p class="tiny refapply__status" id="ref-apply-status" role="status" aria-live="polite"></p>
            </section>

            <!-- Referral stats ----------------------------------------- -->
            <section class="card" aria-labelledby="refstat-heading">
              <div class="card__head">
                ${icon('seal-check')}
                <h2 class="h2" id="refstat-heading">Referral Summary</h2>
              </div>
              <div class="grid grid--2">
                <div class="stat">
                  <span class="stat__k">Successful Referrals</span>
                  <span class="stat__v" id="ref-count">0</span>
                </div>
                <div class="stat">
                  <span class="stat__k">Referral Points Earned</span>
                  <span class="stat__v" id="ref-points">0</span>
                </div>
              </div>
              <div id="ref-list" style="margin-top:12px"></div>
            </section>
          </div>

          <div class="stack">

            <!-- Leaderboard -------------------------------------------- -->
            <section class="card" aria-labelledby="lb-heading">
              <div class="card__head">
                ${icon('trophy')}
                <h2 class="h2" id="lb-heading">${esc(CONFIG.copy.leaderboardTitle)}</h2>
                <div class="row"><span class="badge badge--amber">Demo data</span></div>
              </div>
              <p class="subtle tiny" style="margin:0 0 6px">
                ${esc(CONFIG.copy.leaderboardNotice)}
                Not connected to a backend — production rankings are calculated server-side.
              </p>
              <div class="leader" id="leaderboard"></div>
            </section>

            <!-- Anti-abuse --------------------------------------------- -->
            <section class="card" aria-labelledby="abuse-heading">
              <div class="card__head">
                ${icon('shield-check')}
                <h2 class="h2" id="abuse-heading">Referral Integrity</h2>
              </div>
              <div class="prose">
                <p>
                  Referrals are validated <strong>server-side</strong>. The app never
                  decides on its own that a referral is valid or credits a reward for one.
                </p>
                <ul>
                  <li>Self-referrals are rejected.</li>
                  <li>Duplicate and artificial accounts are detected and voided.</li>
                  <li>Automated referral farming and manipulated reward requests are blocked.</li>
                  <li>Referral rewards may be held until verification completes.</li>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>`;

    this._refs = {
      code: $('#ref-code', root),
      url: $('#ref-url', root),
      hint: $('#ref-hint', root),
      count: $('#ref-count', root),
      points: $('#ref-points', root),
      list: $('#ref-list', root),
      leaderboard: $('#leaderboard', root),
      form: $('#ref-form', root),
      input: $('#ref-input', root),
      apply: $('#ref-apply', root),
      applyStatus: $('#ref-apply-status', root),
    };

    // If this visit came from an invite link, the code is already being applied
    // automatically — lock the field immediately so it cannot be overridden.
    this._incomingLinkCode = new URLSearchParams(location.search).get(CONFIG.app.refParam);

    this._disposers.push(on($('#copy-link', root), 'click', () => this._copy()));
    this._disposers.push(on($('#share-link', root), 'click', () => this._share()));
    this._disposers.push(on(this._refs.form, 'submit', (e) => {
      e.preventDefault();
      this._applyCode();
    }));
    this._disposers.push(on(this._refs.input, 'input', () => {
      // Referral codes are case-insensitive; show them upper-case as typed.
      const el = this._refs.input;
      const pos = el.selectionStart;
      el.value = el.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (pos != null) el.setSelectionRange(pos, pos);
    }));

    this._renderLeaderboard();
    this.update();
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    this._mounted = false;
  }

  _renderLeaderboard() {
    this._refs.leaderboard.innerHTML = DEMO_LEADERBOARD.map((row) => `
      <div class="leader__row leader__row--${row.rank}">
        <span class="leader__rank">${row.rank}</span>
        <span class="leader__name">${esc(row.name)}</span>
        <span class="leader__pts">${fmtPoints(row.points)} points</span>
      </div>`).join('');
  }

  /* ------------------------------------------------------------ rendering */
  update() {
    if (!this._refs) return;
    const r = this.store.state.referrals;
    const url = referralUrl(r.code);

    this._refs.code.textContent = r.code;
    this._refs.url.textContent = url;
    this._refs.count.textContent = fmtInt(r.count);
    this._refs.points.textContent = fmtInt(r.pointsEarned);

    if (r.appliedCode) {
      this._refs.hint.textContent = `Referral code ${r.appliedCode} recorded — pending server verification.`;
    }

    this._syncRedeemField(r);

    // Empty state for the referred-user list.
    if (!r.list || r.list.length === 0) {
      this._refs.list.innerHTML = emptyState(
        'users',
        'No referrals yet',
        'Share your referral link to invite your first miner.',
      );
    } else {
      this._refs.list.innerHTML = r.list.map((u) => `
        <div class="leader__row">
          <span class="leader__name">${esc(u.name)}</span>
          <span class="badge badge--green">${esc(u.status || 'Verified')}</span>
        </div>`).join('');
    }
  }

  /**
   * Keeps the one-time referral field in sync with state.
   * Locked as soon as a code is applied — whether from an invite link or by
   * hand — because a referral can only ever be set once per account.
   */
  _syncRedeemField(r = this.store.state.referrals) {
    const { input, apply, applyStatus } = this._refs;
    if (!input) return;

    const applied = Boolean(r.appliedCode);
    const pendingFromLink = !applied && Boolean(this._incomingLinkCode);
    const locked = applied || pendingFromLink;

    input.disabled = locked;
    apply.disabled = locked;
    input.value = applied ? r.appliedCode : '';

    if (applied) {
      applyStatus.textContent = r.appliedVia === 'link'
        ? `Applied automatically from your invite link: ${r.appliedCode}. This can only be set once.`
        : `Code ${r.appliedCode} applied. This can only be set once.`;
      applyStatus.className = 'tiny refapply__status is-applied';
    } else if (pendingFromLink) {
      applyStatus.textContent = 'Applying the code from your invite link…';
      applyStatus.className = 'tiny refapply__status';
    } else {
      applyStatus.textContent = 'No code applied yet.';
      applyStatus.className = 'tiny refapply__status';
    }
  }

  /**
   * Called by the app once an invite-link code has been resolved (applied or
   * rejected). Until then the field is locked; afterwards it is only locked if
   * a code was actually applied.
   */
  onIncomingReferralSettled() {
    this._incomingLinkCode = null;
    this._syncRedeemField(this.store.state.referrals);
  }

  /* -------------------------------------------------------------- actions */
  async _applyCode() {
    const input = this._refs.input;
    const code = input.value.trim();

    if (!code) {
      toast('Enter a referral code first.', 'warn');
      input.focus();
      sfx.warn();
      return;
    }

    this._refs.apply.disabled = true;
    const res = await this.store.applyReferral(code, { source: 'manual' });

    if (res.ok) {
      toast(res.message || 'Referral code applied.', 'success');
      sfx.success();
    } else {
      toast(res.message || 'That referral code could not be applied.', res.error === 'already-applied' ? 'info' : 'warn');
      if (res.error !== 'already-applied') sfx.warn();
    }

    // The store emits on success; re-sync explicitly for the error paths too.
    this._syncRedeemField(this.store.state.referrals);
  }

  async _copy() {
    const url = referralUrl(this.store.state.referrals.code);
    const ok = await copyText(url);
    toast(ok ? 'Referral link copied.' : 'Could not copy the link.', ok ? 'success' : 'error');
    if (ok) sfx.success(); else sfx.error();
  }

  async _share() {
    const code = this.store.state.referrals.code;
    const url = referralUrl(code);
    const outcome = await shareText({
      title: CONFIG.app.name,
      text: `Join me on ${CONFIG.app.name} — earn LGL Points toward the Lagos Life airdrop.`,
      url,
    });

    if (outcome === 'shared') { toast('Share sheet opened.', 'info'); sfx.success(); }
    else if (outcome === 'copied') { toast('Referral link copied.', 'success'); sfx.success(); }
    else { toast('Sharing is not supported here. Copy the link instead.', 'warn'); sfx.warn(); }
  }
}
