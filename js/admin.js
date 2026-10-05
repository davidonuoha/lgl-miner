/* ==========================================================================
   $LGL Miner — Admin Center
   --------------------------------------------------------------------------
   Passcode-gated operator console with five panels:
     Overview · Users · Ledger · Airdrop · Audit

   Backed by js/admin-store.js:
     · LocalAdminStore  — prototype, everything in this browser
     · ApiAdminStore    — production, talks to /api/admin with a session cookie

   The prototype passcode is defined in admin-store.js (PROTOTYPE_PASSCODE).
   It is NOT a security boundary — see the admin-store header.
   ========================================================================== */

import { LocalAdminStore } from './admin-store.js';
import { icon, logoMark } from './icons.js';
import { $, $$, esc, on, toast } from './ui.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'chart-line-up' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'ledger', label: 'Ledger', icon: 'list-checks' },
  { id: 'airdrop', label: 'Airdrop', icon: 'target' },
  { id: 'audit', label: 'Audit', icon: 'shield-check' },
];

const LEDGER_TYPES = ['all', 'earn', 'bonus', 'referral', 'adjustment', 'reversal', 'airdrop'];

/** Formats a timestamp as a compact UTC date-time. */
function when(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

function nf(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US');
}

function initials(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase();
}

export class AdminCenter {
  /** @param {{playerStore?: object}} [deps] */
  constructor({ playerStore = null } = {}) {
    this.store = new LocalAdminStore();
    this.playerStore = playerStore;
    this.tab = 'overview';
    this.q = '';
    this.filter = 'all';
    this.ledgerType = 'all';
    /** User id whose detail drawer is open, so it survives panel re-renders. */
    this.openUserId = null;
    this._disposers = [];
    this._unsub = null;
    this._mounted = false;
    this._open = false;
    this._busy = false;
  }

  /** Loads the admin state from storage. Call once at boot. */
  async init() {
    try {
      await this.store.init();
    } catch (err) {
      console.warn('[admin] init failed', err);
    }
  }

  /* ------------------------------------------------------------- lifecycle */
  mount(root) {
    if (this._mounted) return;
    this._mounted = true;
    this.root = root;
    root.innerHTML = this._template();
    this._refs = {
      gate: $('#admin-gate', root),
      gateForm: $('#admin-gate-form', root),
      gatePass: $('#admin-passcode', root),
      gateError: $('#admin-gate-error', root),
      shell: $('#admin-shell', root),
      nav: $('#admin-nav', root),
      title: $('#admin-title', root),
      meta: $('#admin-meta', root),
      content: $('#admin-content', root),
      lock: $('#admin-lock', root),
      close: $('#admin-close', root),
    };
    this._bind();
    this._render();
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    this._unsub?.();
    this._unsub = null;
    this._mounted = false;
  }

  async open() {
    this._open = true;
    if (!this._mounted) this.mount(this.root || document.getElementById('admin-screen'));
    this.root.hidden = false;
    this.root.classList.add('is-active');
    document.body.classList.add('is-admin');
    if (this.isAuthed()) {
      this._render();
    } else {
      this._render();
      setTimeout(() => this._refs?.gatePass?.focus(), 60);
    }
  }

  close() {
    this._open = false;
    this.root?.classList.remove('is-active');
    if (this.root) this.root.hidden = true;
    document.body.classList.remove('is-admin');
  }

  toggle() { return this._open ? this.close() : this.open(); }

  isAuthed() { return Boolean(this.store.state?.session?.adminId); }

  /* ---------------------------------------------------------------- template */
  _template() {
    return `
      <div class="admin__gate" id="admin-gate">
        <form class="admin__gate-card" id="admin-gate-form" novalidate>
          <div class="admin__gate-brand">
            ${logoMark('admin__gate-logo')}
            <div>
              <div class="admin__gate-title">Admin Center</div>
              <div class="admin__gate-sub">${esc('$LGL Miner')} · operator access</div>
            </div>
          </div>
          <label class="field" for="admin-passcode">
            <span class="field__label">Admin passcode</span>
            <span class="field__wrap">
              ${icon('lock')}
              <input class="field__input" id="admin-passcode" name="passcode" type="password"
                     autocomplete="off" placeholder="Enter passcode" aria-describedby="admin-gate-error">
            </span>
          </label>
          <p class="auth__error" id="admin-gate-error" role="alert" aria-live="assertive" hidden></p>
          <button class="btn btn--primary btn--block" type="submit" id="admin-gate-submit">
            ${icon('shield-check')} Unlock Admin Center
          </button>
          <p class="tiny muted admin__gate-note">
            Prototype passcode is <code>LGL-ADMIN</code> — set in
            <code>js/admin-store.js</code>. Never use this as real security.
          </p>
          <button class="btn btn--ghost btn--sm admin__gate-close" type="button" id="admin-close">
            ${icon('x')} Close
          </button>
        </form>
      </div>

      <div class="admin__shell" id="admin-shell" hidden>
        <header class="admin__top">
          <div class="admin__brand">
            ${logoMark('admin__logo')}
            <div>
              <div class="admin__name">Admin Center</div>
              <div class="admin__sub" id="admin-meta">—</div>
            </div>
          </div>
          <div class="admin__actions">
            <button class="btn btn--ghost btn--sm" type="button" id="admin-lock">
              ${icon('sign-out')} Lock
            </button>
            <button class="icon-btn" type="button" id="admin-close" aria-label="Close admin center">
              ${icon('x')}
            </button>
          </div>
        </header>

        <nav class="admin__nav" id="admin-nav" aria-label="Admin sections">
          ${TABS.map((t) => `
            <button class="admin__tab" type="button" data-admin-tab="${t.id}">
              ${icon(t.icon)} <span>${t.label}</span>
            </button>`).join('')}
        </nav>

        <main class="admin__content" id="admin-content"></main>
      </div>`;
  }

  /* ---------------------------------------------------------------- bindings */
  _bind() {
    const r = this._refs;

    this._disposers.push(on(r.gateForm, 'submit', (e) => {
      e.preventDefault();
      this._signIn();
    }));

    // Two elements share id="admin-close" (gate + header); bind both.
    $$('[id="admin-close"]', this.root).forEach((btn) => {
      this._disposers.push(on(btn, 'click', () => this.close()));
    });

    this._disposers.push(on(r.lock, 'click', () => this._signOut()));

    this._disposers.push(on(r.nav, 'click', (e) => {
      const tab = e.target.closest('[data-admin-tab]');
      if (!tab) return;
      this.tab = tab.dataset.adminTab;
      this._render();
    }));

    // Delegated handlers for the re-rendered panels.
    this._disposers.push(on(r.content, 'click', (e) => this._onContentClick(e)));
    this._disposers.push(on(r.content, 'input', (e) => this._onContentInput(e)));
    this._disposers.push(on(r.content, 'change', (e) => this._onContentChange(e)));
    this._disposers.push(on(r.content, 'submit', (e) => {
      e.preventDefault();
      this._onContentSubmit(e);
    }));

    this._unsub = this.store.subscribe(() => this._render());
  }

  /* ------------------------------------------------------------------ auth */
  async _signIn() {
    const r = this._refs;
    const passcode = r.gatePass.value;
    if (!passcode) { this._gateError('Enter the admin passcode.'); return; }

    r.gateForm.querySelector('button[type="submit"]').disabled = true;
    try {
      const res = await this.store.signIn(passcode);
      if (!res || res.ok === false) {
        this._gateError(res?.message || 'That passcode is not valid.');
        return;
      }
      r.gateForm.reset();
      this._gateError(null);
      this._render();
    } catch (err) {
      console.error('[admin] sign-in failed', err);
      this._gateError('Could not sign in. Please try again.');
    } finally {
      r.gateForm.querySelector('button[type="submit"]').disabled = false;
    }
  }

  async _signOut() {
    try { await this.store.signOut(); } catch { /* ignore */ }
    toast('Admin session locked.', 'info');
    this._render();
    setTimeout(() => this._refs?.gatePass?.focus(), 60);
  }

  _gateError(message) {
    const el = this._refs?.gateError;
    if (!el) return;
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = message;
  }

  /* ---------------------------------------------------------------- render */
  _render() {
    if (!this._mounted || !this._refs) return;
    const authed = this.isAuthed();

    this._refs.gate.hidden = authed;
    this._refs.shell.hidden = !authed;

    this._refs.nav.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.adminTab === this.tab);
    });

    if (!authed) return;

    const s = this.store.state || {};
    const admin = s.session || {};
    this._refs.meta.textContent =
      `${admin.name || 'Admin'} · signed in ${when(admin.signedInAt)} UTC`;

    this._refs.content.innerHTML = this._panel(this.tab);

    // Re-open the user drawer after any re-render (an admin action emits state).
    if (this.tab === 'users' && this.openUserId) this._openUser(this.openUserId);
  }

  _panel(tab) {
    switch (tab) {
      case 'users': return this._usersPanel();
      case 'ledger': return this._ledgerPanel();
      case 'airdrop': return this._airdropPanel();
      case 'audit': return this._auditPanel();
      default: return this._overviewPanel();
    }
  }

  /* -------------------------------------------------------------- overview */
  _overviewPanel() {
    const s = this.store.state || {};
    const m = this._safe(() => this.store.metrics(), {}) || {};
    const alerts = this._safe(() => this.store.alerts(), []) || [];
    const health = this._safe(() => this.store.health(), []) || [];
    const feed = this._safe(() => this.store.activityFeed(12), []) || [];

    const cards = [
      { label: 'Total users', value: nf(m.users ?? s.users?.length), tone: 'green', icon: 'users' },
      { label: 'Verified', value: nf(m.verified), tone: 'cyan', icon: 'seal-check' },
      { label: 'Active 24h', value: nf(m.active24), tone: 'blue', icon: 'chart-line-up' },
      { label: 'Points issued', value: nf(m.totalPoints), tone: 'purple', icon: 'coins' },
      { label: 'Points 24h', value: nf(m.points24), tone: 'amber', icon: 'clock' },
      { label: 'Risky / flagged', value: nf(m.risky), tone: 'red', icon: 'warning-circle' },
    ];

    return `
      <section class="admin__panel">
        <div class="admin__cards">
          ${cards.map((c) => `
            <article class="admin__card card--${c.tone}">
              <span class="admin__card-icon">${icon(c.icon)}</span>
              <span class="admin__card-value">${c.value}</span>
              <span class="admin__card-label">${esc(c.label)}</span>
            </article>`).join('')}
        </div>

        <div class="admin__grid">
          <section class="admin__block">
            <h3 class="admin__block-title">${icon('warning-circle')} Alerts</h3>
            ${alerts.length ? alerts.slice(0, 6).map((a) => `
              <div class="admin__row">
                <span class="badge badge--${a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'blue'}">
                  ${esc(a.severity || 'info')}
                </span>
                <div class="admin__row-main">
                  <strong>${esc(a.title || 'Alert')}</strong>
                  <span class="tiny muted">${esc(a.detail || '')}</span>
                </div>
                <span class="tiny muted">${when(a.at)}</span>
              </div>`).join('') : '<p class="tiny muted">No open alerts.</p>'}
          </section>

          <section class="admin__block">
            <h3 class="admin__block-title">${icon('shield-check')} System health</h3>
            ${health.length ? health.map((h) => `
              <div class="admin__row">
                <span class="admin__dot admin__dot--${(h.state || h.status) === 'ok' ? 'ok' : (h.state || h.status) === 'warn' ? 'warn' : 'bad'}"></span>
                <div class="admin__row-main"><strong>${esc(h.label || '')}</strong></div>
                <span class="tiny muted">${esc(h.value ?? '')}</span>
              </div>`).join('') : '<p class="tiny muted">No health data.</p>'}
          </section>

          <section class="admin__block admin__block--wide">
            <h3 class="admin__block-title">${icon('clock')} Recent activity</h3>
            ${feed.length ? feed.map((f) => `
              <div class="admin__row">
                <span class="admin__avatar">${esc(initials(f.user || 'S'))}</span>
                <div class="admin__row-main">
                  <strong>${esc(f.text || f.title || f.kind || 'Activity')}</strong>
                  <span class="tiny muted">${esc(f.user || '')}</span>
                </div>
                <span class="tiny muted">${when(f.at || f.createdAt)}</span>
              </div>`).join('') : '<p class="tiny muted">No recent activity.</p>'}
          </section>
        </div>
      </section>`;
  }

  /* ----------------------------------------------------------------- users */
  _usersPanel() {
    const list = this._safe(() => this.store.users({ filter: this.filter, q: this.q }), []) || [];
    const filters = ['all', 'verified', 'flagged', 'active', 'banned'];

    return `
      <section class="admin__panel">
        <div class="admin__toolbar">
          <form class="admin__search" data-admin-form="user-search">
            <span class="field__wrap">
              ${icon('users')}
              <input class="field__input" type="search" name="q" value="${esc(this.q)}"
                     placeholder="Search handle, email or code…" autocomplete="off">
            </span>
          </form>
          <div class="admin__chips">
            ${filters.map((f) => `
              <button class="chip ${f === this.filter ? 'is-active' : ''}" type="button"
                      data-admin-filter="${f}">${f}</button>`).join('')}
          </div>
          <span class="tiny muted">${list.length} shown</span>
        </div>

        <div class="admin__table" role="table">
          <div class="admin__thead" role="row">
            <span>Miner</span><span>Status</span><span>Points</span><span>Referrals</span><span>Last active</span><span></span>
          </div>
          ${list.length ? list.map((u) => `
            <div class="admin__trow" role="row">
              <span class="admin__cell-user">
                <span class="admin__avatar">${esc(initials(u.handle))}</span>
                <span>
                  <strong>${esc(u.handle || u.id)}</strong>
                  <span class="tiny muted">${esc(u.email || '')}${u.isLocalPlayer ? ' · you' : ''}</span>
                </span>
              </span>
              <span>
                <span class="badge badge--${u.status === 'banned' ? 'red' : u.status === 'flagged' ? 'amber' : 'green'}">
                  ${esc(u.status || 'active')}
                </span>
                ${u.verified ? `<span class="badge badge--cyan">verified</span>` : ''}
              </span>
              <span class="admin__cell-num">${nf(u.points)}</span>
              <span class="admin__cell-num">${nf(u.referrals)}</span>
              <span class="tiny muted">${when(u.lastActiveAt)}</span>
              <span>
                <button class="btn btn--ghost btn--sm" type="button" data-admin-user="${esc(u.id)}">
                  Manage ${icon('caret-right')}
                </button>
              </span>
            </div>`).join('') : '<p class="tiny muted admin__empty">No users match this filter.</p>'}
        </div>

        <div class="admin__drawer" id="admin-user-drawer" hidden></div>
      </section>`;
  }

  _userDrawer(user) {
    const flags = Array.isArray(user.flags) ? user.flags : [];
    const flagList = ['suspicious', 'multiAccount', 'bot', 'vpn'];
    return `
      <div class="admin__drawer-head">
        <div>
          <h3>${esc(user.handle || user.id)}</h3>
          <p class="tiny muted">${esc(user.email || '')} · ${esc(user.city || '')}${user.country ? ', ' + esc(user.country) : ''}</p>
        </div>
        <button class="icon-btn" type="button" data-admin-drawer-close aria-label="Close">
          ${icon('x')}
        </button>
      </div>

      <div class="admin__drawer-stats">
        <div><span>${nf(user.points)}</span><small>points</small></div>
        <div><span>${nf(user.lifetimePoints)}</span><small>lifetime</small></div>
        <div><span>${nf(user.totalTaps)}</span><small>taps</small></div>
        <div><span>${nf(user.referrals)}</span><small>referrals</small></div>
      </div>

      <form class="admin__drawer-block" data-admin-form="adjust" data-user-id="${esc(user.id)}">
        <h4>${icon('coins')} Adjust points</h4>
        <div class="admin__inline">
          <select class="admin__select" name="direction">
            <option value="credit">Credit (+)</option>
            <option value="debit">Debit (−)</option>
          </select>
          <input class="admin__input" type="number" name="amount" min="1" step="1" value="100" required>
        </div>
        <input class="admin__input" type="text" name="reason" placeholder="Reason (recorded in the ledger)" required>
        <button class="btn btn--primary btn--sm" type="submit">Apply adjustment</button>
      </form>

      <div class="admin__drawer-block">
        <h4>${icon('seal-check')} Status</h4>
        <div class="admin__chips">
          ${['active', 'flagged', 'banned'].map((st) => `
            <button class="chip ${user.status === st ? 'is-active' : ''}" type="button"
                    data-admin-status="${st}" data-user-id="${esc(user.id)}">${st}</button>`).join('')}
        </div>
      </div>

      <div class="admin__drawer-block">
        <h4>${icon('warning-circle')} Risk flags</h4>
        <div class="admin__chips">
          ${flagList.map((f) => `
            <button class="chip ${flags.includes(f) ? 'is-active' : ''}" type="button"
                    data-admin-flag="${f}" data-user-id="${esc(user.id)}"
                    data-flag-value="${flags.includes(f) ? 'false' : 'true'}">${f}</button>`).join('')}
        </div>
        <p class="tiny muted">Risk score: <strong>${nf(user.risk)}</strong>${user.riskSignals?.length ? ' · ' + esc(user.riskSignals.join(', ')) : ''}</p>
      </div>

      <div class="admin__drawer-block">
        <h4>${icon('gift')} Referral</h4>
        <p class="tiny muted">Code <strong>${esc(user.referralCode || '—')}</strong> · referred by <strong>${esc(user.referredBy || '—')}</strong></p>
      </div>`;
  }

  /** Resolves a user id to a display handle, falling back to the raw id. */
  _handle(userId) {
    if (!userId) return '';
    const u = this._safe(() => this.store.user?.(userId), null)
      || this.store.state?.users?.find((x) => x.id === userId);
    return u?.handle || userId;
  }

  /* ---------------------------------------------------------------- ledger */
  _ledgerPanel() {
    const list = this._safe(() => this.store.ledger({ type: this.ledgerType, q: this.q, limit: 200 }), []) || [];
    return `
      <section class="admin__panel">
        <div class="admin__toolbar">
          <div class="admin__chips">
            ${LEDGER_TYPES.map((t) => `
              <button class="chip ${t === this.ledgerType ? 'is-active' : ''}" type="button"
                      data-admin-ledger="${t}">${t}</button>`).join('')}
          </div>
          <span class="tiny muted">${list.length} entries</span>
        </div>

        <div class="admin__table" role="table">
          <div class="admin__thead admin__thead--ledger" role="row">
            <span>When</span><span>Miner</span><span>Type</span><span>Amount</span><span>Balance</span><span>Reason</span><span>Action</span>
          </div>
          ${list.length ? list.map((e) => `
            <div class="admin__trow admin__trow--ledger" role="row">
              <span class="tiny muted">${when(e.createdAt || e.at)}</span>
              <span class="admin__cell-user">
                <span class="admin__avatar">${esc(initials(this._handle(e.userId)))}</span>
                <span class="tiny">${esc(this._handle(e.userId))}</span>
              </span>
              <span><span class="badge badge--blue">${esc(e.type || '')}</span></span>
              <span class="admin__cell-num ${e.direction === 'debit' ? 'is-neg' : 'is-pos'}">
                ${e.direction === 'debit' ? '−' : '+'}${nf(e.amount)}
              </span>
              <span class="admin__cell-num">${nf(e.newBalance)}</span>
              <span class="tiny muted">${esc(e.reason || e.label || '')}</span>
              <span>
                ${e.reversed
                  ? '<span class="badge badge--red">reversed</span>'
                  : `<button class="btn btn--ghost btn--sm" type="button" data-admin-reverse="${esc(e.id)}">Reverse</button>`}
              </span>
            </div>`).join('') : '<p class="tiny muted admin__empty">No ledger entries.</p>'}
        </div>
      </section>`;
  }

  /* --------------------------------------------------------------- airdrop */
  _airdropPanel() {
    const a = this.store.state?.airdrop || {};
    const phases = Array.isArray(a.phases) && a.phases.length
      ? a.phases.map((p) => (typeof p === 'string' ? p : p.id || p.label)).filter(Boolean)
      : ['mining', 'snapshot', 'claim', 'distribution'];

    return `
      <section class="admin__panel">
        <div class="admin__grid">
          <section class="admin__block">
            <h3 class="admin__block-title">${icon('target')} Phase</h3>
            <p class="tiny muted">Current phase: <strong>${esc(a.phase || '—')}</strong></p>
            <div class="admin__chips">
              ${phases.map((p) => `
                <button class="chip ${p === a.phase ? 'is-active' : ''}" type="button"
                        data-admin-phase="${esc(p)}">${esc(p)}</button>`).join('')}
            </div>
          </section>

          <section class="admin__block">
            <h3 class="admin__block-title">${icon('seal-check')} Snapshot &amp; eligibility</h3>
            <div class="admin__kv"><span>Snapshot</span><strong>${esc(a.snapshotStatus || '—')}</strong></div>
            <div class="admin__kv"><span>Snapshot at</span><strong>${when(a.snapshotAt)}</strong></div>
            <div class="admin__kv"><span>Eligibility</span><strong>${esc(a.eligibilityStatus || '—')}</strong></div>
            <div class="admin__kv"><span>Claim enabled</span><strong>${a.claimEnabled ? 'Yes' : 'No'}</strong></div>
          </section>

          <section class="admin__block admin__block--wide">
            <h3 class="admin__block-title">${icon('gift')} Allocation</h3>
            <form data-admin-form="allocation">
              <label class="admin__check">
                <input type="checkbox" name="available" ${a.allocationAvailable ? 'checked' : ''}>
                <span>Allocation conversion available to users</span>
              </label>
              <label class="field" for="admin-formula">
                <span class="field__label">Formula note (shown to users)</span>
                <span class="field__wrap">
                  <input class="field__input" id="admin-formula" name="formulaNote" type="text"
                         value="${esc(a.allocationFormulaNote || '')}"
                         placeholder="e.g. Points convert at launch; the rate is not final.">
                </span>
              </label>
              <button class="btn btn--primary btn--sm" type="submit">Save allocation</button>
            </form>
            ${Array.isArray(a.announcements) && a.announcements.length ? `
              <h4 class="admin__block-sub">${icon('megaphone')} Announcements</h4>
              ${a.announcements.slice(0, 5).map((n) => `
                <div class="admin__row">
                  <div class="admin__row-main">
                    <strong>${esc(n.title || n.text || 'Announcement')}</strong>
                    <span class="tiny muted">${esc(n.body || '')}</span>
                  </div>
                  <span class="tiny muted">${when(n.at || n.createdAt)}</span>
                </div>`).join('')}` : ''}
          </section>
        </div>
      </section>`;
  }

  /* ----------------------------------------------------------------- audit */
  _auditPanel() {
    const list = this.store.state?.audit || [];
    return `
      <section class="admin__panel">
        <div class="admin__toolbar">
          <span class="tiny muted">${list.length} audit events</span>
        </div>
        <div class="admin__table" role="table">
          <div class="admin__thead admin__thead--audit" role="row">
            <span>When</span><span>Actor</span><span>Action</span><span>Target</span><span>Detail</span>
          </div>
          ${list.length ? list.slice().reverse().slice(0, 300).map((e) => `
            <div class="admin__trow admin__trow--audit" role="row">
              <span class="tiny muted">${when(e.at || e.createdAt)}</span>
              <span class="tiny">${esc(e.actorName || e.actorId || e.actor || '—')}</span>
              <span><span class="badge badge--purple">${esc(e.action || '')}</span></span>
              <span class="tiny">${esc(e.target || e.targetId || '—')}</span>
              <span class="tiny muted">${esc(e.detail || e.reason || '')}</span>
            </div>`).join('') : '<p class="tiny muted admin__empty">No audit events yet. Actions you take here will appear.</p>'}
        </div>
      </section>`;
  }

  /* -------------------------------------------------------------- handlers */
  _onContentClick(e) {
    const t = e.target;

    const filter = t.closest('[data-admin-filter]');
    if (filter) { this.filter = filter.dataset.adminFilter; this._render(); return; }

    const ledger = t.closest('[data-admin-ledger]');
    if (ledger) { this.ledgerType = ledger.dataset.adminLedger; this._render(); return; }

    const manage = t.closest('[data-admin-user]');
    if (manage) { this._openUser(manage.dataset.adminUser); return; }

    if (t.closest('[data-admin-drawer-close]')) { this._closeDrawer(); return; }

    const status = t.closest('[data-admin-status]');
    if (status) { this._setStatus(status.dataset.userId, status.dataset.adminStatus); return; }

    const flag = t.closest('[data-admin-flag]');
    if (flag) {
      this._setFlag(flag.dataset.userId, flag.dataset.adminFlag, flag.dataset.flagValue === 'true');
      return;
    }

    const reverse = t.closest('[data-admin-reverse]');
    if (reverse) { this._reverse(reverse.dataset.adminReverse); return; }

    const phase = t.closest('[data-admin-phase]');
    if (phase) { this._setPhase(phase.dataset.adminPhase); }
  }

  _onContentInput(e) {
    if (e.target.name === 'q' && e.target.closest('[data-admin-form="user-search"]')) {
      this.q = e.target.value;
      // Re-render only the table body would be ideal; a full render is fine here
      // but would lose focus, so filter in place instead.
      this._filterUsersInPlace();
    }
  }

  _onContentChange() { /* selects are read on submit */ }

  _onContentSubmit(e) {
    const form = e.target.closest('[data-admin-form]');
    if (!form) return;
    const kind = form.dataset.adminForm;
    if (kind === 'adjust') this._adjust(form);
    else if (kind === 'allocation') this._saveAllocation(form);
  }

  _filterUsersInPlace() {
    const list = this._safe(() => this.store.users({ filter: this.filter, q: this.q }), []) || [];
    const table = this._refs.content.querySelector('.admin__table');
    if (!table) return;
    const body = table.querySelectorAll('.admin__trow');
    // Simplest correct approach: re-render the panel and restore focus/caret.
    const active = document.activeElement;
    const caret = active?.selectionStart;
    this._render();
    const input = this._refs.content.querySelector('[data-admin-form="user-search"] input[name="q"]');
    if (input) {
      input.focus();
      try { input.setSelectionRange(caret, caret); } catch { /* ignore */ }
    }
    void body; void list;
  }

  _openUser(userId) {
    const user = this._safe(() => this.store.user?.(userId), null) || this.store.state?.users?.find((u) => u.id === userId);
    const drawer = this._refs.content.querySelector('#admin-user-drawer');
    if (!drawer || !user) return;
    this.openUserId = userId;
    drawer.innerHTML = this._userDrawer(user);
    drawer.hidden = false;
    drawer.classList.add('is-open');
  }

  _closeDrawer() {
    this.openUserId = null;
    const drawer = this._refs.content.querySelector('#admin-user-drawer');
    if (!drawer) return;
    drawer.hidden = true;
    drawer.classList.remove('is-open');
  }

  async _adjust(form) {
    const userId = form.dataset.userId;
    const direction = form.elements.direction.value;
    const amount = Math.round(Number(form.elements.amount.value));
    const reason = form.elements.reason.value.trim();
    if (!Number.isFinite(amount) || amount <= 0) { toast('Enter a positive amount.', 'warn'); return; }
    if (!reason) { toast('A reason is required.', 'warn'); return; }

    const res = await this.store.adjustPoints({ userId, direction, amount, reason });
    if (res && res.ok === false) { toast(res.message || 'Adjustment failed.', 'warn'); return; }

    toast(`Points ${direction === 'debit' ? 'debited' : 'credited'}.`, 'success');
    this._syncLocalPlayer(userId);
    this._refreshDrawer(userId);
  }

  async _setStatus(userId, status) {
    const res = await this.store.setUserStatus(userId, status, 'Set from Admin Center');
    if (res && res.ok === false) { toast(res.message || 'Could not update status.', 'warn'); return; }
    toast(`Status set to ${status}.`, 'success');
    this._refreshDrawer(userId);
  }

  async _setFlag(userId, flag, value) {
    const res = await this.store.setUserFlag(userId, flag, value, 'Set from Admin Center');
    if (res && res.ok === false) { toast(res.message || 'Could not update flag.', 'warn'); return; }
    this._refreshDrawer(userId);
  }

  async _reverse(entryId) {
    const res = await this.store.reverseLedgerEntry(entryId, 'Reversed from Admin Center');
    if (res && res.ok === false) { toast(res.message || 'Could not reverse entry.', 'warn'); return; }
    toast('Ledger entry reversed.', 'success');
  }

  async _setPhase(phase) {
    const res = await this.store.setAirdropPhase(phase, 'Set from Admin Center');
    if (res && res.ok === false) { toast(res.message || 'Could not set phase.', 'warn'); return; }
    toast(`Airdrop phase set to ${phase}.`, 'success');
  }

  async _saveAllocation(form) {
    const available = Boolean(form.elements.available?.checked);
    const formulaNote = form.elements.formulaNote?.value.trim() || '';
    const res = await this.store.setAllocation({ available, formulaNote });
    if (res && res.ok === false) { toast(res.message || 'Could not save allocation.', 'warn'); return; }
    toast('Allocation settings saved.', 'success');
  }

  /**
   * If the adjusted user is the signed-in player, mirror the new balance into
   * the live app store so the UI updates without a reload.
   */
  _syncLocalPlayer(userId) {
    if (!this.playerStore) return;
    const user = this.store.state?.users?.find((u) => u.id === userId);
    if (!user || !user.isLocalPlayer) return;
    this.playerStore.applyAdminAdjustment?.({
      points: user.points,
      lifetimePoints: user.lifetimePoints,
    });
  }

  _refreshDrawer(userId) {
    this.openUserId = userId;
    const drawer = this._refs.content.querySelector('#admin-user-drawer');
    if (drawer && !drawer.hidden) this._openUser(userId);
  }

  /** Runs a read helper, falling back safely if the API is unavailable. */
  _safe(fn, fallback) {
    try {
      const value = fn();
      return value === undefined || value === null ? fallback : value;
    } catch (err) {
      console.warn('[admin] read failed', err);
      return fallback;
    }
  }
}
