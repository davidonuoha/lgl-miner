/* ==========================================================================
   $LGL Miner — Data layer
   --------------------------------------------------------------------------
   The app NEVER talks to storage directly. It talks to a `Store`.

   Two implementations are provided:

     • LocalStore  — demo persistence in localStorage. Used for the prototype.
     • ApiStore    — skeleton for the production backend. Every mutating call
                     is a server round-trip; the server owns the truth.

   Swap implementations in one place (js/app.js):

       import { ApiStore } from './store.js';
       const store = new ApiStore({ baseUrl: '/api' });

   ─────────────────────────────────────────────────────────────────────────
   SECURITY MODEL (read before wiring a backend)
   ─────────────────────────────────────────────────────────────────────────
   LocalStore is a UI prototype. A client can always edit localStorage, so
   NO client-side value may be trusted in production. Every mutation that
   grants points, energy, task rewards, ad rewards or referral credit MUST be
   authorised and calculated by the server. The frontend may render a
   predicted value optimistically, but the server response is authoritative.

   The `Store` interface below is deliberately shaped so that the local and
   remote implementations are interchangeable: every mutating method is
   async and returns { ok, error?, state, delta? }.
   ========================================================================== */

import { CONFIG, referralUrl } from './config.js';

const STORAGE_KEY = 'lgl-miner:state:v1'; // legacy single-user key (pre-auth)
const ACCOUNTS_KEY = 'lgl-miner:accounts:v1';
const SESSION_KEY = 'lgl-miner:session:v1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

/** Per-account state key, so two accounts never share progress. */
const stateKey = (userId) => `${STORAGE_KEY}:${userId}`;

/** Lowercases and trims an email address. */
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

/** Best-effort hex random string (crypto-backed where available). */
function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derives a salted passcode hash.
 *
 * Prefers SHA-256 via Web Crypto. Falls back to a small non-cryptographic
 * mix only when `crypto.subtle` is unavailable (plain-HTTP contexts), so the
 * prototype still works there. NEITHER path is a security boundary — see the
 * module header. Production verifies passcodes server-side.
 */
export async function hashPasscode(passcode, salt) {
  const data = `${salt}:${String(passcode)}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < data.length; i += 1) {
    const c = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `fallback-${h1.toString(16)}${h2.toString(16)}`;
}

/** Validates an email + passcode pair for the prototype forms. */
export function validateCredentials(email, passcode, { requirePasscode = true } = {}) {
  const value = normalizeEmail(email);
  if (!value) return { ok: false, error: 'email-required', message: 'Enter your email address.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { ok: false, error: 'invalid-email', message: 'Enter a valid email address.' };
  }
  if (!requirePasscode) return { ok: true, email: value };
  const min = CONFIG.auth?.minPasscodeLength ?? 8;
  if (!passcode) return { ok: false, error: 'passcode-required', message: 'Enter your passcode.' };
  if (String(passcode).length < min) {
    return { ok: false, error: 'weak-passcode', message: `Your passcode must be at least ${min} characters.` };
  }
  return { ok: true, email: value };
}

/** A friendly default handle derived from the email local-part. */
function handleFromEmail(email) {
  const local = String(email).split('@')[0] || 'miner';
  const cleaned = local.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24);
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Lagos Miner';
}

/* --------------------------------------------------------------------------
   Date helpers
   -------------------------------------------------------------------------- */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const now = () => Date.now();

/* --------------------------------------------------------------------------
   Default state
   -------------------------------------------------------------------------- */
function createInitialState() {
  return {
    version: 1,
    user: {
      id: makeId('usr'),
      createdAt: now(),
      handle: 'Lagos Miner',
      email: null,
    },
    points: 0,
    energy: CONFIG.mining.maxEnergy,
    /** Timestamp anchoring energy regeneration maths. */
    energyUpdatedAt: now(),
    totalTaps: 0,
    multiplier: CONFIG.mining.defaultMultiplier,
    today: { date: dayKey(), pointsEarned: 0, taps: 0 },
    dailyBonus: { lastClaimedDate: null },
    tasks: {
      completed: {},          // taskId -> true  (non-repeatable completion)
      claimedAt: {},          // taskId -> timestamp
      exploredCommunity: false,
      watchedAdToday: false,
      watchedAdDate: null,
    },
    referrals: {
      code: makeCode(),
      count: 0,
      /** The one referral code this account has redeemed (or null). */
      appliedCode: null,
      /** How it was applied: 'link' (invite URL) or 'manual' (typed). */
      appliedVia: null,
      pointsEarned: 0,
      /** Demo-only list of referred users. Server-provided in production. */
      list: [],
    },
    settings: {
      haptics: true,
      sound: true,
      notifications: true,
    },
    wallet: { connected: false, address: null },

    /* ------------------------------------------------------------------
       $LGL allocation / conversion — SERVER-AUTHORITATIVE.

       The frontend NEVER computes these fields. During the Mining Phase
       `available` is false and every figure stays null, so the UI shows
       "Not available yet". Only when the backend/admin system officially
       opens the allocation phase does it set `available: true` and supply
       `eligiblePoints` and `finalAmount` — already calculated server-side.

       Do not add a conversion rate, formula, or client-side maths here.
       ------------------------------------------------------------------ */
    allocation: {
      /** Only the backend may set this to true. */
      available: false,
      /** Which phase the project is in: mining | allocation | claim. */
      phase: 'mining',
      /** Server-supplied. Displayed only when `available` is true. */
      eligiblePoints: null,
      /** Server-supplied final $LGL amount. Never derived on the client. */
      finalAmount: null,
      /** Optional server note about the official formula. */
      formulaNote: null,
    },

    meta: { lastActiveAt: now(), lastSeenDay: dayKey() },
  };
}

/* --------------------------------------------------------------------------
   Small utils
   -------------------------------------------------------------------------- */
function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeCode() {
  let out = 'LGL-';
  for (let i = 0; i < 4; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* ==========================================================================
   Store — abstract interface
   ========================================================================== */
export class Store {
  /** @returns {Promise<object>} the hydrated state */
  async init() { throw new Error('not implemented'); }

  /** Synchronous snapshot for rendering. */
  get state() { throw new Error('not implemented'); }

  /** Register a listener called after every successful mutation. */
  subscribe() { throw new Error('not implemented'); }

  /** Advances time-based state (energy refill, daily rollover). */
  tick() { return this._state ?? null; }

  /* ---------------------------------------------------------- auth ----- */
  /** @returns {boolean} whether a valid session is active. */
  isAuthenticated() { return false; }

  /** @returns {{userId: string, email: string, handle: string}|null} */
  currentAccount() { return null; }

  /** Creates an account and starts a session. @returns {Promise<AuthResult>} */
  async signUp() { throw new Error('not implemented'); }

  /** Verifies credentials and starts a session. @returns {Promise<AuthResult>} */
  async signIn() { throw new Error('not implemented'); }

  /** Ends the session. @returns {Promise<AuthResult>} */
  async signOut() { throw new Error('not implemented'); }

  /**
   * Mirrors a points change made in the Admin Center into the live player
   * state so the UI updates without a reload. Server stores treat the server
   * as authoritative and can ignore this.
   */
  applyAdminAdjustment() { return { ok: false }; }

  /** Apply `n` mining taps. @returns {Promise<MutationResult>} */
  async tap() { throw new Error('not implemented'); }

  async claimDailyBonus() { throw new Error('not implemented'); }
  async claimRewardedAd() { throw new Error('not implemented'); }
  async claimTask() { throw new Error('not implemented'); }
  async completeTaskAction() { throw new Error('not implemented'); }
  async applyReferral() { throw new Error('not implemented'); }
  async updateSettings() { throw new Error('not implemented'); }
  async reset() { throw new Error('not implemented'); }
}

/**
 * @typedef {Object} MutationResult
 * @property {boolean} ok
 * @property {string}  [error]   Machine-readable error code.
 * @property {string}  [message] Human-readable message for a toast.
 * @property {object}  state     State after the mutation.
 * @property {object}  [delta]   What changed, for optimistic UI / feedback.
 */

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok
 * @property {string}  [error]   Machine-readable error code.
 * @property {string}  [message] Human-readable message for the form/toast.
 * @property {object}  state     State after the attempt.
 * @property {{userId: string, email: string, handle: string}} [account]
 */

/* ==========================================================================
   LocalStore — localStorage-backed demo persistence
   ========================================================================== */
export class LocalStore extends Store {
  constructor() {
    super();
    this._state = createInitialState();
    this._listeners = new Set();
    this._saveTimer = null;
    /** email -> account record */
    this._accounts = {};
    /** active session record, or null */
    this._session = null;
    /** userId of the active account (null while signed out) */
    this._userId = null;
    /** pre-auth single-user state, adopted by the first account created */
    this._legacyState = null;
  }

  /* ------------------------------------------------------------- auth ---- */
  isAuthenticated() { return Boolean(this._session && this._userId); }

  currentAccount() {
    if (!this.isAuthenticated()) return null;
    const account = this._accounts[this._session.email];
    return {
      userId: this._userId,
      email: this._session.email,
      handle: account?.handle || this._state.user.handle,
    };
  }

  get state() { return this._state; }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this._state);
  }

  /**
   * Advances the energy refill clock without a user action.
   *
   * Called once per second by the mining screen. It deliberately does NOT emit
   * on every tick — energy refills continuously and emitting would re-render
   * every view once a second. The caller re-reads `state` itself. A calendar
   * rollover *does* change visible state, so that case emits.
   */
  tick() {
    const previousDay = this._state.today.date;
    this._rolloverIfNewDay();
    this._regenerateEnergy();
    this._persist();
    if (this._state.today.date !== previousDay) this._emit();
    return this._state;
  }

  /**
   * Writes are coalesced so rapid tapping does not hammer localStorage
   * (a real bottleneck on low-end Android). The in-memory state is always
   * current; the disk write happens at most every 400ms.
   */
  _persist() {
    // Nothing is persisted until an account is signed in, so a signed-out
    // browser never leaves a stray anonymous balance behind.
    if (!this._userId) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._writeState();
    }, 400);
  }

  _writeState() {
    if (!this._userId) return;
    try {
      localStorage.setItem(stateKey(this._userId), JSON.stringify(this._state));
    } catch (err) {
      // Quota / private-mode failures must never break mining.
      console.warn('[store] persist failed', err);
    }
  }

  /** Force an immediate write (used on pagehide). */
  flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._writeState();
  }

  /* ---------------------------------------------------- storage helpers -- */
  _readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[store] read failed', key, err);
      return null;
    }
  }

  _writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[store] write failed', key, err);
    }
  }

  _saveAccounts() { this._writeJSON(ACCOUNTS_KEY, this._accounts); }

  /** Builds a state object from storage, defensively merging new fields. */
  _loadState(userId) {
    const base = createInitialState();
    const stored = this._readJSON(stateKey(userId));
    if (!stored || typeof stored !== 'object' || stored.version !== 1) return base;
    const merged = { ...base, ...stored };
    merged.user = { ...base.user, ...stored.user };
    merged.today = { ...base.today, ...stored.today };
    merged.dailyBonus = { ...base.dailyBonus, ...stored.dailyBonus };
    merged.tasks = { ...base.tasks, ...stored.tasks };
    merged.referrals = { ...base.referrals, ...stored.referrals };
    merged.settings = { ...base.settings, ...stored.settings };
    merged.wallet = { ...base.wallet, ...stored.wallet };
    merged.allocation = { ...base.allocation, ...stored.allocation };
    merged.meta = { ...base.meta, ...stored.meta };
    return merged;
  }

  async init() {
    this._accounts = this._readJSON(ACCOUNTS_KEY) || {};
    this._session = this._readJSON(SESSION_KEY);
    // A pre-auth build may have left a single anonymous state behind. Keep it
    // so the first account created can adopt the progress instead of losing it.
    this._legacyState = this._readJSON(STORAGE_KEY);

    const sessionValid =
      this._session &&
      typeof this._session.userId === 'string' &&
      Number(this._session.expiresAt) > now() &&
      this._accounts[this._session.email];

    if (sessionValid) {
      this._userId = this._session.userId;
      this._state = this._loadState(this._userId);
      this._state.user = {
        ...this._state.user,
        email: this._session.email,
        handle: this._accounts[this._session.email]?.handle || this._state.user.handle,
      };
      this._rolloverIfNewDay();
      this._regenerateEnergy();
      this._persist();
    } else {
      // Expired or missing session: start signed out with a blank state.
      this._session = null;
      this._userId = null;
      this._state = createInitialState();
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    }

    this._emit();
    return this._state;
  }

  /** Starts and persists a session for an account. */
  _startSession(account) {
    const days = CONFIG.auth?.sessionDays ?? 30;
    this._session = {
      userId: account.userId,
      email: account.email,
      token: randomHex(16),
      issuedAt: now(),
      expiresAt: now() + days * 24 * 60 * 60 * 1000,
    };
    this._writeJSON(SESSION_KEY, this._session);
  }

  /** Creates an account, seeds its state and signs it in. */
  async signUp({ email, passcode } = {}) {
    const check = validateCredentials(email, passcode);
    if (!check.ok) return { ok: false, ...check, state: this._state };
    if (this._accounts[check.email]) {
      return { ok: false, error: 'email-taken', message: 'An account already exists for that email.', state: this._state };
    }

    const salt = randomHex(8);
    const passcodeHash = await hashPasscode(passcode, salt);
    const userId = makeId('usr');
    const account = {
      email: check.email,
      userId,
      handle: handleFromEmail(check.email),
      salt,
      passcodeHash,
      createdAt: now(),
    };

    const isFirstAccount = Object.keys(this._accounts).length === 0;
    this._accounts[check.email] = account;
    this._saveAccounts();

    // Adopt any pre-auth progress into the first account created.
    if (isFirstAccount && this._legacyState && this._legacyState.version === 1) {
      const base = createInitialState();
      this._state = { ...base, ...this._legacyState };
      this._state.user = { ...base.user, ...this._legacyState.user };
      this._legacyState = null;
      // The legacy single-user key has been adopted; drop it so it is never
      // adopted a second time.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    } else {
      this._state = createInitialState();
    }
    this._state.user = { ...this._state.user, id: userId, email: check.email, handle: account.handle };

    this._userId = userId;
    this._startSession(account);
    this._rolloverIfNewDay();
    this._regenerateEnergy();
    this._writeState();
    this._emit();
    return { ok: true, state: this._state, account: this.currentAccount(), message: 'Account created.' };
  }

  /** Verifies credentials and signs in. */
  async signIn({ email, passcode } = {}) {
    const check = validateCredentials(email, passcode, { requirePasscode: false });
    if (!check.ok) return { ok: false, ...check, state: this._state };

    const account = this._accounts[check.email];
    // Always run a hash so a missing account and a wrong passcode take a
    // similar amount of time and cannot be distinguished by timing.
    const salt = account?.salt || 'no-such-account';
    const attempt = await hashPasscode(passcode, salt);
    if (!account || attempt !== account.passcodeHash) {
      return { ok: false, error: 'invalid-credentials', message: 'Email or passcode is incorrect.', state: this._state };
    }

    this._userId = account.userId;
    this._state = this._loadState(account.userId);
    this._state.user = { ...this._state.user, id: account.userId, email: account.email, handle: account.handle };
    this._startSession(account);
    this._rolloverIfNewDay();
    this._regenerateEnergy();
    this._writeState();
    this._emit();
    return { ok: true, state: this._state, account: this.currentAccount(), message: 'Signed in.' };
  }

  /** Ends the session. The account and its progress stay on disk. */
  async signOut() {
    this.flush();
    this._session = null;
    this._userId = null;
    this._state = createInitialState();
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    this._emit();
    return { ok: true, state: this._state, message: 'Signed out.' };
  }

  /** Applies a points change made in the Admin Center to the signed-in player. */
  applyAdminAdjustment({ points, lifetimePoints } = {}) {
    if (!this._userId) return { ok: false, state: this._state };
    if (Number.isFinite(points)) this._state.points = Math.max(0, Math.round(points));
    if (Number.isFinite(lifetimePoints)) this._state.lifetimePoints = Math.max(0, Math.round(lifetimePoints));
    this._state.meta = { ...(this._state.meta || {}), updatedAt: now() };
    this.flush();
    this._emit();
    return { ok: true, state: this._state };
  }

  /* ------------------------------------------------------------------
     Internal rules — these are the LOCAL mirrors of server-side rules.
     Keep them in one place so the backend can port them 1:1.
     ------------------------------------------------------------------ */

  /** Resets daily counters and daily tasks when the calendar day changes. */
  _rolloverIfNewDay() {
    const today = dayKey();
    if (this._state.today.date === today) return;

    this._state.today = { date: today, pointsEarned: 0, taps: 0 };
    this._state.tasks.watchedAdToday = false;
    this._state.tasks.watchedAdDate = null;

    // Daily tasks become claimable again on a new day.
    for (const task of CONFIG.tasks) {
      if (task.daily) {
        delete this._state.tasks.completed[task.id];
        delete this._state.tasks.claimedAt[task.id];
      }
    }
    this._state.meta.lastSeenDay = today;
  }

  /**
   * Energy refills continuously. A full 0 → maxEnergy refill takes
   * CONFIG.mining.energyRefillSeconds (default: one hour).
   *
   * Energy is stored as a float so the bar advances smoothly; the UI floors it
   * for display. `energyUpdatedAt` always advances to `now`, so the maths never
   * drifts or "banks" fractions.
   */
  _regenerateEnergy() {
    const { maxEnergy } = CONFIG.mining;
    const s = this._state;
    const t = now();

    if (s.energy >= maxEnergy) {
      s.energy = maxEnergy;
      s.energyUpdatedAt = t;
      return;
    }

    const gained = ((t - s.energyUpdatedAt) / 1000) * this.energyPerSecond();
    if (gained > 0) s.energy = Math.min(maxEnergy, s.energy + gained);
    s.energyUpdatedAt = t;
  }

  /** Energy restored per second across the whole tank. */
  energyPerSecond() {
    const { maxEnergy, energyRefillSeconds } = CONFIG.mining;
    return maxEnergy / Math.max(1, energyRefillSeconds);
  }

  /** Seconds until the next whole energy point (0 when full). */
  secondsToNextEnergy() {
    const { maxEnergy } = CONFIG.mining;
    const s = this._state;
    if (s.energy >= maxEnergy) return 0;
    const missingToNext = Math.ceil(s.energy) - s.energy;
    const need = missingToNext <= 0 ? 1 : missingToNext;
    return Math.ceil(need / this.energyPerSecond());
  }

  /** Seconds until the tank is completely full (0 when full). */
  secondsToFullRefill() {
    const { maxEnergy } = CONFIG.mining;
    const s = this._state;
    if (s.energy >= maxEnergy) return 0;
    return Math.ceil((maxEnergy - s.energy) / this.energyPerSecond());
  }

  /* ------------------------------------------------------------------
     Mutations
     ------------------------------------------------------------------ */

  async tap(count = 1) {
    this._rolloverIfNewDay();
    this._regenerateEnergy();

    const s = this._state;
    const { perTap, energyPerTap, maxEnergy } = CONFIG.mining;

    // Rate guard: a real client cannot legitimately exceed this burst size.
    const requested = clamp(Math.floor(count), 0, CONFIG.mining.maxTapsPerSecond);
    const affordable = Math.floor(s.energy / energyPerTap);
    const applied = Math.min(requested, affordable);

    if (applied <= 0) {
      return {
        ok: false,
        error: 'no-energy',
        message: 'Not enough energy.',
        state: s,
      };
    }

    const gained = applied * perTap * s.multiplier;
    s.points += gained;
    s.energy = clamp(s.energy - applied * energyPerTap, 0, maxEnergy);
    s.totalTaps += applied;
    s.today.pointsEarned += gained;
    s.today.taps += applied;
    s.meta.lastActiveAt = now();
    // Anchor the refill clock to this instant so no regeneration is "banked"
    // for the time spent tapping.
    s.energyUpdatedAt = now();

    this._persist();
    this._emit();
    return { ok: true, state: s, delta: { applied, gained, points: gained } };
  }

  async claimDailyBonus() {
    this._rolloverIfNewDay();
    const s = this._state;
    const today = dayKey();

    if (s.dailyBonus.lastClaimedDate === today) {
      return { ok: false, error: 'already-claimed', message: 'Daily bonus already claimed.', state: s };
    }

    const amount = CONFIG.rewards.dailyBonusPoints;
    s.dailyBonus.lastClaimedDate = today;
    s.points += amount;
    s.today.pointsEarned += amount;
    this._persist();
    this._emit();
    return {
      ok: true,
      state: s,
      delta: { points: amount },
      message: `+${amount} LGL Points earned.`,
    };
  }

  async claimRewardedAd() {
    this._rolloverIfNewDay();
    const s = this._state;
    if (s.tasks.watchedAdToday) {
      return { ok: false, error: 'already-claimed', message: 'Reward already claimed today.', state: s };
    }

    const amount = CONFIG.rewards.rewardedAdEnergy;
    s.energy = clamp(s.energy + amount, 0, CONFIG.mining.maxEnergy);
    s.tasks.watchedAdToday = true;
    s.tasks.watchedAdDate = dayKey();
    this._persist();
    this._emit();
    return { ok: true, state: s, delta: { energy: amount }, message: `+${amount} energy reward.` };
  }

  /** Progress value for a task definition, evaluated against current state. */
  taskProgress(task) {
    return task.progress ? task.progress(this._state) : 0;
  }

  taskStatus(task) {
    const s = this._state;
    const done = Boolean(s.tasks.completed[task.id]);
    const progress = this.taskProgress(task);
    const target = task.target || 1;
    return {
      done,
      claimable: !done && progress >= target,
      progress: Math.min(progress, target),
      target,
    };
  }

  async claimTask(taskId) {
    this._rolloverIfNewDay();
    const s = this._state;
    const task = CONFIG.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: 'unknown-task', message: 'Task not found.', state: s };

    const status = this.taskStatus(task);
    if (status.done) {
      return { ok: false, error: 'already-claimed', message: 'Task already completed.', state: s };
    }
    if (!status.claimable) {
      return { ok: false, error: 'incomplete', message: 'Task not complete yet.', state: s };
    }

    // NOTE: In production the server decides whether the task is genuinely
    // complete. Never trust a client-supplied "taskId + complete" claim.
    s.tasks.completed[taskId] = true;
    s.tasks.claimedAt[taskId] = now();

    if (task.reward.type === 'energy') {
      s.energy = clamp(s.energy + task.reward.amount, 0, CONFIG.mining.maxEnergy);
    } else {
      s.points += task.reward.amount;
      s.today.pointsEarned += task.reward.amount;
    }

    this._persist();
    this._emit();
    return { ok: true, state: s, delta: { reward: task.reward }, message: 'Task completed.' };
  }

  /**
   * Performs a task's non-reward action (e.g. mark "explored community").
   * Separated from claiming so progress can exist before the reward.
   */
  async completeTaskAction(taskId) {
    const s = this._state;
    if (taskId === 'explore-lagos-life') {
      s.tasks.exploredCommunity = true;
      this._persist();
      this._emit();
      return { ok: true, state: s };
    }
    return { ok: false, error: 'no-action', state: s };
  }

  /**
   * Applies a referral code from the URL.
   *
   * IMPORTANT: this local implementation only records the code so the UI can
   * show it. It deliberately does NOT award points, because referral validity
   * (self-referral, duplicate accounts, farming) can only be decided by the
   * server. See ApiStore.applyReferral for the production shape.
   */
  /**
   * Redeems a referral code. This is a ONE-TIME action per account: once a
   * code has been applied it can never be changed, whether it arrived through
   * an invite link or was typed by hand.
   *
   * @param {string} code
   * @param {{source?: 'link'|'manual'}} [options]
   */
  async applyReferral(code, { source = 'manual' } = {}) {
    const s = this._state;
    if (!code || !String(code).trim()) return { ok: false, error: 'no-code', message: 'Enter a referral code.', state: s };

    const normalised = String(code).trim().toUpperCase();
    if (normalised === s.referrals.code) {
      return { ok: false, error: 'self-referral', message: 'You cannot refer yourself.', state: s };
    }
    if (s.referrals.appliedCode) {
      return {
        ok: false,
        error: 'already-applied',
        message: `Referral code ${s.referrals.appliedCode} is already linked to this account.`,
        state: s,
      };
    }

    s.referrals.appliedCode = normalised;
    s.referrals.appliedVia = source === 'link' ? 'link' : 'manual';
    this._persist();
    this._emit();
    // No points are granted client-side. The server would validate & credit.
    return {
      ok: true,
      state: s,
      message: source === 'link'
        ? `Referral code ${normalised} applied from your invite link.`
        : `Referral code ${normalised} recorded — pending verification.`,
    };
  }

  async updateSettings(patch) {
    this._state.settings = { ...this._state.settings, ...patch };
    this._persist();
    this._emit();
    return { ok: true, state: this._state };
  }

  async reset() {
    const account = this.currentAccount();
    this._state = createInitialState();
    // Resetting progress must NOT sign the user out or erase their identity.
    if (account) {
      this._state.user = {
        ...this._state.user,
        id: account.userId,
        email: account.email,
        handle: account.handle,
      };
    }
    this.flush();
    this._emit();
    return { ok: true, state: this._state };
  }
}

/* ==========================================================================
   ApiStore — production skeleton
   --------------------------------------------------------------------------
   This is intentionally NOT wired up. It documents exactly where each
   server-authoritative call goes so the backend can be dropped in without
   touching any UI code.

   Server responsibilities (see README → Production backend):
     POST /api/session          → identity + signed session token
     POST /api/tap              → validate taps, energy, rate; return delta
     POST /api/bonus/daily      → idempotent per calendar day
     POST /api/rewarded-ad      → verify ad-provider SSV token, then grant
     POST /api/tasks/:id/claim  → verify completion server-side, grant once
     POST /api/referrals/apply  → anti-abuse checks, then credit referrer
     GET  /api/state            → authoritative snapshot for rendering

   $LGL CONVERSION / ALLOCATION — SERVER-ONLY
     The frontend NEVER converts points into $LGL. There is no rate, no
     formula and no estimate in this codebase, by design.

     `GET /api/state` is the ONLY source of the `allocation` object:

       allocation: {
         available: boolean,        // false throughout the Mining Phase
         phase: 'mining' | 'allocation' | 'claim',
         eligiblePoints: number|null,   // server-calculated
         finalAmount: number|null,      // server-calculated, in $LGL
         formulaNote: string|null,      // official wording for the formula
       }

     The admin system flips `available` to true and supplies the figures
     when the project officially enters the Allocation Phase. Until then the
     UI renders "Not available yet" and shows no figure at all.

     Do NOT add a client-side conversion here. If a future requirement needs
     a live rate, it must arrive as a server field — never as frontend maths.
   ========================================================================== */
export class ApiStore extends Store {
  /**
   * @param {{ baseUrl: string, fetchImpl?: typeof fetch }} options
   */
  constructor({ baseUrl = '/api', fetchImpl = fetch } = {}) {
    super();
    this.baseUrl = baseUrl;
    this._fetch = fetchImpl;
    this._state = createInitialState();
    this._listeners = new Set();
    /** Server-reported identity for the active session, or null. */
    this._auth = null;
  }

  get state() { return this._state; }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() { for (const fn of this._listeners) fn(this._state); }

  isAuthenticated() { return Boolean(this._auth && this._auth.userId); }

  currentAccount() { return this._auth; }

  async _request(path, body) {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include', // session cookie, never a client-held secret
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      return { ok: false, error: 'server-error', message: 'Something went wrong. Please try again.', state: this._state };
    }
    const data = await res.json();
    // The server returns the authoritative state; we never merge client maths.
    if (data.state) { this._state = data.state; this._emit(); }
    return data;
  }

  /** The server owns the clock; the client never regenerates energy locally. */
  tick() { return this._state; }

  /**
   * Restores the session from the server, then loads the authoritative state.
   * The session lives in an httpOnly cookie the client cannot read or forge.
   */
  async init() {
    try {
      const sessionRes = await this._fetch(`${this.baseUrl}/auth/session`, { credentials: 'include' });
      if (sessionRes.ok) {
        const data = await sessionRes.json();
        this._auth = data.user || null;
      }
    } catch { /* offline / no backend: stay signed out */ }

    if (this.isAuthenticated()) {
      try {
        const res = await this._fetch(`${this.baseUrl}/state`, { credentials: 'include' });
        if (res.ok) this._state = await res.json();
      } catch { /* keep the blank state */ }
    }
    this._emit();
    return this._state;
  }

  /** POSTs an auth request and adopts the returned identity + state. */
  async _authRequest(path, body) {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || 'auth-failed',
        message: data.message || 'That did not work. Please try again.',
        state: this._state,
      };
    }
    if (data.user) this._auth = data.user;
    if (data.state) this._state = data.state;
    this._emit();
    return { ok: true, state: this._state, account: this._auth, message: data.message };
  }

  /** The server creates the account and sets the session cookie. */
  async signUp({ email, passcode } = {}) {
    return this._authRequest('/auth/register', { email, passcode });
  }

  async signIn({ email, passcode } = {}) {
    return this._authRequest('/auth/login', { email, passcode });
  }

  async signOut() {
    const res = await this._authRequest('/auth/logout', {}).catch(() => ({ ok: true }));
    this._auth = null;
    this._state = createInitialState();
    this._emit();
    return { ok: true, state: this._state, message: res?.message };
  }

  /** Sends the tap burst; the server clamps and computes the real reward. */
  async tap(count = 1) { return this._request('/tap', { count }); }
  async claimDailyBonus() { return this._request('/bonus/daily'); }
  /** `providerToken` comes from the ad network's server-side verification callback. */
  async claimRewardedAd(providerToken) { return this._request('/rewarded-ad', { providerToken }); }
  async claimTask(taskId) { return this._request(`/tasks/${encodeURIComponent(taskId)}/claim`); }
  async completeTaskAction(taskId) { return this._request(`/tasks/${encodeURIComponent(taskId)}/action`); }
  /** `source` is advisory; the server decides validity and credits rewards. */
  async applyReferral(code, { source = 'manual' } = {}) {
    return this._request('/referrals/apply', { code, source });
  }
  async updateSettings(patch) { return this._request('/settings', patch); }
  async reset() { return { ok: true, state: this._state }; }
}

/* --------------------------------------------------------------------------
   Demo leaderboard.
   Clearly labelled as demo data in the UI — not connected to a backend.
   -------------------------------------------------------------------------- */
export const DEMO_LEADERBOARD = [
  { rank: 1, name: 'Lagos Pioneer', points: 84200 },
  { rank: 2, name: 'Island Builder', points: 71480 },
  { rank: 3, name: 'Mainland Miner', points: 65190 },
  { rank: 4, name: 'Eko Explorer', points: 52340 },
  { rank: 5, name: 'Third Mainland', points: 47610 },
];

export { referralUrl };
