/* ==========================================================================
   $LGL Miner — ADMIN CENTER data layer
   --------------------------------------------------------------------------
   SECURITY MODEL — READ THIS FIRST

   There is exactly ONE Super Admin. There are no roles, no staff accounts and
   no permission management, by design.

   This file contains two implementations of the same interface:

     LocalAdminStore  — the prototype. Persists to localStorage so the whole
                        Admin Center is explorable without a server.

     ApiAdminStore    — the production seam. Every method maps to a server
                        endpoint listed in ADMIN_API below.

   THE PROTOTYPE IS NOT SECURE AND MUST NOT BE TREATED AS A SECURITY BOUNDARY.
   Everything LocalAdminStore does — the passcode gate, the point balance
   arithmetic, the audit log — happens in the browser and can be bypassed with
   devtools. It exists so the flows and the UI contract are real.

   In production:
     · authentication is a server-issued, httpOnly, SameSite session cookie
     · EVERY mutation is authorised server-side against that session
     · the server recomputes balances from its own ledger and ignores any
       balance the client sends
     · the audit log is append-only server-side and never trusts client input

   The UI NEVER writes a balance. It calls a method here, and here the balance
   is recomputed from the previous value plus the delta. ApiAdminStore sends
   only the DELTA and the reason — never a target balance.
   ========================================================================== */

import { CONFIG } from './config.js';

/* ==========================================================================
   Server contract. This is the specification ApiAdminStore implements.
   ========================================================================== */
export const ADMIN_API = {
  session: {
    read: 'GET    /api/admin/session',
    create: 'POST   /api/admin/session            { passcode }',
    destroy: 'DELETE /api/admin/session',
  },
  overview: 'GET    /api/admin/overview',
  users: {
    list: 'GET    /api/admin/users?filter=&q=&page=&sort=',
    read: 'GET    /api/admin/users/:id',
    status: 'POST   /api/admin/users/:id/status   { status, reason }',
    flags: 'POST   /api/admin/users/:id/flags    { flag, value, reason }',
    points: 'POST   /api/admin/users/:id/points   { direction, amount, reason, idempotencyKey }',
  },
  ledger: {
    list: 'GET    /api/admin/ledger?userId=&type=&from=&to=&page=',
    reverse: 'POST   /api/admin/ledger/:id/reverse { reason, idempotencyKey }',
  },
  mining: 'GET|PUT /api/admin/mining              { ...settings, reason }',
  tasks: 'GET|POST /api/admin/tasks · PATCH /api/admin/tasks/:id',
  referrals: 'GET|PUT /api/admin/referrals           { ...settings, reason }',
  airdrop: {
    read: 'GET    /api/admin/airdrop',
    phase: 'POST   /api/admin/airdrop/phase       { phase, reason }',
    snapshot: 'POST   /api/admin/airdrop/snapshot    { action, reason }',
  },
  communication: 'GET|POST /api/admin/announcements · PATCH /api/admin/announcements/:id',
  security: 'GET|PUT /api/admin/security            { ...settings, reason }',
  wallet: 'GET|PUT /api/admin/claim               { ...settings, reason }',
  system: 'GET|PUT /api/admin/system              { ...settings, reason }',
  audit: 'GET    /api/admin/audit?action=&from=&to=&page=',
  reports: 'GET    /api/admin/reports/:kind?from=&to=&format=csv|json',
  profile: 'GET|PUT /api/admin/profile · DELETE /api/admin/sessions/:id',
};

/* ==========================================================================
   Helpers
   ========================================================================== */

/** Deterministic PRNG so the demo dataset is stable across reloads. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const between = (rnd, lo, hi) => Math.floor(rnd() * (hi - lo + 1)) + lo;

export const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const PLAYER_KEY = 'lgl-miner:state:v1';
const ADMIN_KEY = 'lgl.admin:v1';

/** Prototype-only gate. NOT a security boundary — see the header comment. */
export const PROTOTYPE_PASSCODE = 'LGL-ADMIN';

/** Bump to force the demo dataset to be regenerated for existing visitors. */
const SEED_VERSION = 2;

/* ==========================================================================
   Demo dataset
   ========================================================================== */

const HANDLE_A = ['Lagos', 'Island', 'Mainland', 'Eko', 'Third', 'Yaba', 'Lekki', 'Ikeja',
  'Surulere', 'Ajah', 'Ikoyi', 'Mushin', 'Oshodi', 'Festac', 'Apapa', 'Gbagada'];
const HANDLE_B = ['Pioneer', 'Builder', 'Miner', 'Explorer', 'Trader', 'Nomad', 'Spark',
  'Node', 'Vault', 'Runner', 'Anchor', 'Bridge', 'Forge', 'Crest'];

const DEVICES = [
  'Android 14 · Chrome', 'Android 13 · Chrome', 'iOS 17 · Safari',
  'Android 12 · Chrome', 'Windows 11 · Chrome', 'macOS 14 · Safari',
  'Android 11 · Chrome', 'iOS 16 · Safari',
];
const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Benin City', 'Enugu'];

function makeUser(rnd, i, nowMs) {
  const handle = `${pick(rnd, HANDLE_A)} ${pick(rnd, HANDLE_B)}`;
  const lifetime = between(rnd, 1200, 96000);
  const points = Math.max(0, lifetime - between(rnd, 0, 4200));
  const referrals = between(rnd, 0, 26);
  const risk = rnd() < 0.14 ? between(rnd, 55, 92) : between(rnd, 0, 34);
  const suspended = risk >= 80 && rnd() < 0.55;
  const verified = rnd() < 0.55 ? 'verified' : (rnd() < 0.6 ? 'pending' : 'unverified');
  const daysAgo = between(rnd, 1, 120);

  const signals = [];
  if (risk >= 50) {
    if (rnd() < 0.7) signals.push('Impossible tap rate');
    if (rnd() < 0.5) signals.push('Referral cluster overlap');
    if (rnd() < 0.4) signals.push('Shared device fingerprint');
    if (rnd() < 0.3) signals.push('New account, high activity');
  }

  return {
    id: `usr_${String(i).padStart(4, '0')}`,
    handle,
    email: `${handle.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    city: pick(rnd, CITIES),
    country: 'NG',
    device: pick(rnd, DEVICES),
    joinedAt: nowMs - daysAgo * 86400000,
    lastActiveAt: nowMs - between(rnd, 0, 72) * 3600000,
    status: suspended ? 'suspended' : 'active',
    verified,
    points,
    lifetimePoints: lifetime,
    energy: between(rnd, 0, CONFIG.mining.maxEnergy),
    totalTaps: Math.round(lifetime / CONFIG.mining.perTap),
    multiplier: rnd() < 0.18 ? 2 : 1,
    referralCode: `LGL-${handle.slice(0, 2).toUpperCase()}${String(i).padStart(2, '0')}${between(rnd, 10, 99)}`,
    referrals: {
      count: referrals,
      pointsEarned: referrals * CONFIG.rewards.referralPoints,
      appliedCode: rnd() < 0.7 ? `LGL-REF${between(rnd, 100, 999)}` : null,
    },
    flags: suspended ? ['multi-account'] : (risk > 60 ? ['watchlist'] : []),
    risk,
    riskSignals: signals,
    wallet: rnd() < 0.22 ? { address: `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`, verified: rnd() < 0.5 } : null,
    tasksCompleted: between(rnd, 0, CONFIG.tasks.length),
    dailyStreak: between(rnd, 0, 34),
    /** True for the account created by this browser's own app instance. */
    isLocalPlayer: false,
  };
}

function seedAdminState() {
  const nowMs = Date.now();
  const rnd = mulberry32(20270301);

  const users = [];
  for (let i = 1; i <= 24; i += 1) users.push(makeUser(rnd, i, nowMs));

  // The player on THIS device is always the first row, so the Super Admin can
  // adjust their own balance and immediately see it in the main app.
  users.unshift({
    id: 'usr_local',
    handle: 'Lagos Miner',
    email: 'local@this-device',
    city: 'Lagos',
    country: 'NG',
    device: 'This device',
    joinedAt: nowMs - 3 * 86400000,
    lastActiveAt: nowMs,
    status: 'active',
    verified: 'pending',
    points: 0,
    lifetimePoints: 0,
    energy: CONFIG.mining.maxEnergy,
    totalTaps: 0,
    multiplier: 1,
    referralCode: 'LGL-LOCAL',
    referrals: { count: 0, pointsEarned: 0, appliedCode: null },
    flags: [],
    risk: 0,
    riskSignals: [],
    wallet: null,
    tasksCompleted: 0,
    dailyStreak: 0,
    isLocalPlayer: true,
  });

  const ledger = [];
  const audit = [];
  for (const u of users) {
    if (u.isLocalPlayer) continue;
    const entries = between(rnd, 4, 10);
    let balance = Math.max(0, u.points - between(rnd, 200, 900));
    for (let i = 0; i < entries; i += 1) {
      const type = pick(rnd, ['mining', 'task', 'referral', 'daily_bonus', 'mining', 'mining']);
      const amount = type === 'referral' ? CONFIG.rewards.referralPoints
        : type === 'task' ? 50
          : type === 'daily_bonus' ? CONFIG.rewards.dailyBonusPoints
            : between(rnd, 40, 900);
      const previousBalance = balance;
      balance += amount;
      ledger.push({
        id: uid('led'),
        userId: u.id,
        type,
        label: LEDGER_LABEL[type],
        direction: 'credit',
        amount,
        previousBalance,
        newBalance: balance,
        reason: null,
        actorId: null,
        actorName: null,
        // Monotonic per user: the balance chain is built in generation order,
        // so timestamps must increase with `i` or the integrity walk breaks.
        createdAt: nowMs - (720 - i * 60) * 3600000,
      });
    }
    u.points = balance;
    u.lifetimePoints = Math.max(u.lifetimePoints, balance);
  }

  ledger.sort((a, b) => b.createdAt - a.createdAt);

  return {
    version: SEED_VERSION,
    seededAt: nowMs,
    session: null,
    users,
    ledger,
    audit,
    mining: {
      perTap: CONFIG.mining.perTap,
      defaultMultiplier: CONFIG.mining.defaultMultiplier,
      maxEnergy: CONFIG.mining.maxEnergy,
      energyPerTap: CONFIG.mining.energyPerTap,
      energyRefillSeconds: CONFIG.mining.energyRefillSeconds,
      maxTapsPerSecond: CONFIG.mining.maxTapsPerSecond,
      dailyBonusPoints: CONFIG.rewards.dailyBonusPoints,
      rewardedAdEnergy: CONFIG.rewards.rewardedAdEnergy,
      dailyBonusEnabled: true,
      miningEnabled: true,
      cooldownSeconds: 0,
      dailyPointsCap: 0,
      weeklyPointsCap: 0,
      allowNegativeBalance: false,
    },
    tasks: CONFIG.tasks.map((t, i) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category || (i === 0 ? 'daily' : i === 1 ? 'social' : i === 3 ? 'referral' : 'special'),
      rewardType: t.reward.type,
      rewardAmount: t.reward.amount,
      target: t.target ?? 1,
      repeatable: Boolean(t.repeatable),
      enabled: true,
      pendingVerification: i === 1 ? 3 : 0,
      completions: between(rnd, 40, 2400),
    })),
    referrals: {
      enabled: true,
      rewardPoints: CONFIG.rewards.referralPoints,
      refereeBonusPoints: CONFIG.rewards.refereeBonusPoints,
      requireVerification: true,
      maxReferralsPerDay: 20,
      minAccountAgeHours: 24,
      blockSameDevice: true,
      suspiciousCount: users.filter((u) => u.riskSignals.includes('Referral cluster overlap')).length,
    },
    airdrop: {
      phase: 'mining',
      phases: CONFIG.conversion.phases.map((p) => ({ id: p.id, label: p.label })),
      snapshotStatus: 'not_taken',
      snapshotAt: null,
      eligibilityStatus: 'not_started',
      eligibilityVerified: 0,
      allocationAvailable: false,
      allocationFormulaNote: null,
      claimEnabled: false,
      announcements: [],
    },
    communication: {
      announcements: [],
      banners: [],
      scheduled: [],
    },
    security: {
      rateLimitPerMinute: 240,
      botDetectionEnabled: true,
      duplicateAccountDetection: true,
      referralAbuseDetection: true,
      autoSuspendRiskScore: 85,
      requireVerifiedForReferral: true,
      blocked: users.filter((u) => u.status === 'suspended').map((u) => u.id),
      events: [],
    },
    claim: {
      enabled: false,
      contractAddress: null,
      network: null,
      claimOpensAt: null,
      walletVerificationRequired: true,
      failedClaims: [],
    },
    system: {
      maintenanceMode: false,
      maintenanceMessage: 'We are performing scheduled maintenance. Please check back shortly.',
      pwaEnabled: true,
      forceUpdate: false,
      platformName: CONFIG.app.name,
      supportUrl: null,
      scheduledEvents: [],
      logs: [],
    },
    profile: {
      id: 'admin_1',
      name: 'Super Admin',
      email: 'admin@lgl-miner',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      twoFactor: false,
      lastPasscodeChange: nowMs,
    },
    loginHistory: [
      { id: uid('log'), at: nowMs - 3600000, ip: '203.0.113.24', device: 'This browser', ok: true },
      { id: uid('log'), at: nowMs - 26 * 3600000, ip: '203.0.113.24', device: 'This browser', ok: true },
    ],
    sessions: [
      { id: uid('ses'), device: 'This browser', ip: '203.0.113.24', startedAt: nowMs - 3600000, current: true },
    ],
  };
}

export const LEDGER_LABEL = {
  mining: 'Mining Reward',
  task: 'Task Reward',
  referral: 'Referral Reward',
  daily_bonus: 'Daily Bonus',
  admin_adjustment: 'Admin Adjustment',
  reversal: 'Reversal',
  airdrop: 'Airdrop Allocation',
};

/* ==========================================================================
   Shared validation — used by BOTH implementations, mirroring the server rules
   ========================================================================== */

export const MIN_REASON_LENGTH = 8;
export const MAX_ADJUSTMENT = 10000000;

/**
 * Validates a points adjustment exactly as the server must.
 * Returns { ok, error } — never mutates anything.
 */
export function validateAdjustment({ direction, amount, reason, currentBalance, allowNegative = false }) {
  const amt = Number(amount);
  if (!Number.isFinite(amt)) return { ok: false, error: 'Enter a valid amount.' };
  if (!Number.isInteger(amt)) return { ok: false, error: 'Amount must be a whole number.' };
  if (amt <= 0) return { ok: false, error: 'Amount must be greater than zero.' };
  if (amt > MAX_ADJUSTMENT) return { ok: false, error: `Amount exceeds the maximum of ${MAX_ADJUSTMENT.toLocaleString()}.` };
  if (direction !== 'credit' && direction !== 'debit') return { ok: false, error: 'Choose top up or deduct.' };

  const text = String(reason ?? '').trim();
  if (text.length < MIN_REASON_LENGTH) {
    return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
  }
  if (direction === 'debit' && !allowNegative && amt > currentBalance) {
    return {
      ok: false,
      error: `Cannot deduct ${amt.toLocaleString()} — the balance is ${currentBalance.toLocaleString()}.`,
    };
  }
  return { ok: true, error: null, amount: amt, reason: text };
}

/* ==========================================================================
   LocalAdminStore — the prototype implementation
   ========================================================================== */
export class LocalAdminStore {
  constructor({ storage = globalThis.localStorage } = {}) {
    this._storage = storage;
    this._state = null;
    this._listeners = new Set();
  }

  /* ------------------------------------------------------------- lifecycle */
  async init() {
    try {
      const raw = this._storage.getItem(ADMIN_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      // Re-seed when the demo dataset shape/version changes.
      this._state = stored && stored.version === SEED_VERSION ? stored : seedAdminState();
    } catch {
      this._state = seedAdminState();
    }
    this._syncLocalPlayer();
    return this._state;
  }

  get state() { return this._state; }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    this._persist();
    for (const fn of this._listeners) fn(this._state);
  }

  _persist() {
    try { this._storage.setItem(ADMIN_KEY, JSON.stringify(this._state)); } catch { /* quota */ }
  }

  /** Mirrors the player's real balance into the admin user table. */
  _syncLocalPlayer() {
    const u = this._state.users.find((x) => x.isLocalPlayer);
    if (!u) return;
    try {
      const raw = this._storage.getItem(PLAYER_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      u.points = Number(p.points) || 0;
      u.lifetimePoints = Math.max(u.lifetimePoints, u.points);
      u.totalTaps = Number(p.totalTaps) || 0;
      u.multiplier = Number(p.multiplier) || 1;
      u.energy = Math.round(Number(p.energy) || 0);
      u.referrals = {
        count: Number(p.referrals?.count) || 0,
        pointsEarned: Number(p.referrals?.pointsEarned) || 0,
        appliedCode: p.referrals?.appliedCode ?? null,
      };
      u.referralCode = p.referrals?.code || u.referralCode;
      u.wallet = p.wallet?.connected ? { address: p.wallet.address, verified: false } : null;
    } catch { /* ignore */ }
  }

  /** Writes a new balance back to the player app's own storage. */
  _writeLocalPlayerBalance(next) {
    try {
      const raw = this._storage.getItem(PLAYER_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      p.points = next;
      this._storage.setItem(PLAYER_KEY, JSON.stringify(p));
    } catch { /* ignore */ }
  }

  /* --------------------------------------------------------------- session */
  async signIn(passcode) {
    if (String(passcode ?? '').trim() !== PROTOTYPE_PASSCODE) {
      this._recordLogin(false);
      return { ok: false, error: 'Incorrect passcode.' };
    }
    this._state.session = {
      adminId: this._state.profile.id,
      name: this._state.profile.name,
      signedInAt: Date.now(),
    };
    this._recordLogin(true);
    this._emit();
    return { ok: true };
  }

  async signOut() {
    this._state.session = null;
    this._emit();
    return { ok: true };
  }

  _recordLogin(ok) {
    this._state.loginHistory.unshift({
      id: uid('log'), at: Date.now(), ip: '127.0.0.1 (prototype)', device: 'This browser', ok,
    });
    this._state.loginHistory = this._state.loginHistory.slice(0, 40);
  }

  /* ----------------------------------------------------------------- reads */
  users({ filter = 'all', q = '' } = {}) {
    this._syncLocalPlayer();
    let rows = [...this._state.users];
    if (filter === 'active') rows = rows.filter((u) => u.status === 'active');
    if (filter === 'suspended') rows = rows.filter((u) => u.status === 'suspended');
    if (filter === 'unverified') rows = rows.filter((u) => u.verified !== 'verified');
    if (filter === 'risky') rows = rows.filter((u) => u.risk >= 50);
    if (filter === 'flagged') rows = rows.filter((u) => u.flags.length > 0);
    const needle = q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((u) =>
        u.handle.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.id.toLowerCase().includes(needle) ||
        u.referralCode.toLowerCase().includes(needle));
    }
    return rows.sort((a, b) => b.points - a.points);
  }

  user(id) {
    this._syncLocalPlayer();
    return this._state.users.find((u) => u.id === id) || null;
  }

  userLedger(id, { type = 'all' } = {}) {
    return this._state.ledger
      .filter((e) => e.userId === id && (type === 'all' || e.type === type))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  ledger({ type = 'all', q = '', limit = 200 } = {}) {
    let rows = [...this._state.ledger];
    if (type !== 'all') rows = rows.filter((e) => e.type === type);
    const needle = q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((e) => {
        const u = this.user(e.userId);
        return (u?.handle.toLowerCase().includes(needle) ?? false)
          || (e.reason?.toLowerCase().includes(needle) ?? false)
          || e.id.toLowerCase().includes(needle);
      });
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  audit({ action = 'all', limit = 300 } = {}) {
    let rows = [...this._state.audit];
    if (action !== 'all') rows = rows.filter((e) => e.action === action);
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  /* ---------------------------------------------------------------- writes */

  /**
   * THE CENTREPIECE — manual points adjustment.

   * Note what this method does NOT accept: a target balance. It takes a
   * direction and a delta, recomputes the new balance itself, and records both
   * the ledger entry and the audit entry. A production ApiAdminStore sends the
   * same payload to the server, which repeats every check below.
   */
  async adjustPoints({ userId, direction, amount, reason }) {
    const user = this.user(userId);
    if (!user) return { ok: false, error: 'User not found.' };

    const check = validateAdjustment({
      direction,
      amount,
      reason,
      currentBalance: user.points,
      allowNegative: this._state.mining.allowNegativeBalance,
    });
    if (!check.ok) return { ok: false, error: check.error };

    const previousBalance = user.points;
    const delta = direction === 'credit' ? check.amount : -check.amount;
    const newBalance = previousBalance + delta;

    // Guard the invariant the server also enforces.
    if (newBalance < 0 && !this._state.mining.allowNegativeBalance) {
      return { ok: false, error: 'That deduction would create a negative balance.' };
    }

    user.points = newBalance;
    if (direction === 'credit') user.lifetimePoints = Math.max(user.lifetimePoints, newBalance);

    const entry = {
      id: uid('led'),
      userId,
      type: 'admin_adjustment',
      label: LEDGER_LABEL.admin_adjustment,
      direction,
      amount: check.amount,
      previousBalance,
      newBalance,
      reason: check.reason,
      actorId: this._state.profile.id,
      actorName: this._state.profile.name,
      createdAt: Date.now(),
    };
    this._state.ledger.unshift(entry);

    this._audit({
      action: direction === 'credit' ? 'points.topup' : 'points.deduct',
      target: { type: 'user', id: userId, label: user.handle },
      amount: check.amount,
      reason: check.reason,
      previousBalance,
      newBalance,
    });

    if (user.isLocalPlayer) this._writeLocalPlayerBalance(newBalance);

    this._emit();
    return { ok: true, entry, user };
  }

  async reverseLedgerEntry(entryId, reason) {
    const original = this._state.ledger.find((e) => e.id === entryId);
    if (!original) return { ok: false, error: 'Ledger entry not found.' };
    if (original.type === 'reversal') return { ok: false, error: 'A reversal cannot be reversed.' };
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const user = this.user(original.userId);
    if (!user) return { ok: false, error: 'User not found.' };

    const previousBalance = user.points;
    const delta = original.direction === 'credit' ? -original.amount : original.amount;
    const newBalance = previousBalance + delta;
    if (newBalance < 0 && !this._state.mining.allowNegativeBalance) {
      return { ok: false, error: 'Reversing this entry would create a negative balance.' };
    }

    user.points = newBalance;
    this._state.ledger.unshift({
      id: uid('led'),
      userId: user.id,
      type: 'reversal',
      label: LEDGER_LABEL.reversal,
      direction: delta >= 0 ? 'credit' : 'debit',
      amount: Math.abs(delta),
      previousBalance,
      newBalance,
      reason: text,
      actorId: this._state.profile.id,
      actorName: this._state.profile.name,
      reversesId: original.id,
      createdAt: Date.now(),
    });

    this._audit({
      action: 'points.reverse',
      target: { type: 'user', id: user.id, label: user.handle },
      amount: Math.abs(delta),
      reason: text,
      previousBalance,
      newBalance,
      meta: { reversesId: original.id },
    });

    if (user.isLocalPlayer) this._writeLocalPlayerBalance(newBalance);
    this._emit();
    return { ok: true };
  }

  async setUserStatus(userId, status, reason) {
    const user = this.user(userId);
    if (!user) return { ok: false, error: 'User not found.' };
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const previous = user.status;
    user.status = status;
    if (status === 'suspended') {
      if (!this._state.security.blocked.includes(userId)) this._state.security.blocked.push(userId);
    } else {
      this._state.security.blocked = this._state.security.blocked.filter((id) => id !== userId);
    }
    this._audit({
      action: status === 'suspended' ? 'user.suspend' : 'user.reinstate',
      target: { type: 'user', id: userId, label: user.handle },
      reason: text,
      meta: { from: previous, to: status },
    });
    this._emit();
    return { ok: true };
  }

  async setUserFlag(userId, flag, value, reason) {
    const user = this.user(userId);
    if (!user) return { ok: false, error: 'User not found.' };
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const has = user.flags.includes(flag);
    if (value && !has) user.flags.push(flag);
    if (!value && has) user.flags = user.flags.filter((f) => f !== flag);
    this._audit({
      action: 'user.flag',
      target: { type: 'user', id: userId, label: user.handle },
      reason: text,
      meta: { flag, value },
    });
    this._emit();
    return { ok: true };
  }

  async updateMining(patch, reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const before = { ...this._state.mining };
    this._state.mining = { ...this._state.mining, ...patch };
    this._audit({
      action: 'mining.update',
      target: { type: 'config', id: 'mining', label: 'Mining settings' },
      reason: text,
      meta: { changed: Object.keys(patch), before },
    });
    this._emit();
    return { ok: true };
  }

  async updateSettings(section, patch, reason, action) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const before = { ...this._state[section] };
    this._state[section] = { ...this._state[section], ...patch };
    this._audit({
      action: action || `${section}.update`,
      target: { type: 'config', id: section, label: section },
      reason: text,
      meta: { changed: Object.keys(patch), before },
    });
    this._emit();
    return { ok: true };
  }

  /**
   * Phase change. This is the ONLY thing that can open $LGL allocation to
   * users, and it writes through to the player's own state so the app's
   * conversion card follows the server decision.
   */
  async setAirdropPhase(phase, reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const before = this._state.airdrop.phase;
    this._state.airdrop.phase = phase;

    // Only the allocation/claim phases may expose an allocation, and even then
    // only when the Super Admin has explicitly enabled it with figures.
    if (phase === 'mining') {
      this._state.airdrop.allocationAvailable = false;
      this._state.airdrop.claimEnabled = false;
    }

    try {
      const raw = this._storage.getItem(PLAYER_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        p.allocation = {
          available: this._state.airdrop.allocationAvailable,
          phase,
          eligiblePoints: this._state.airdrop.allocationAvailable ? p.points : null,
          finalAmount: null,
          formulaNote: this._state.airdrop.allocationFormulaNote,
        };
        this._storage.setItem(PLAYER_KEY, JSON.stringify(p));
      }
    } catch { /* ignore */ }

    this._audit({
      action: 'airdrop.phase',
      target: { type: 'airdrop', id: 'phase', label: 'Airdrop phase' },
      reason: text,
      meta: { from: before, to: phase },
    });
    this._emit();
    return { ok: true };
  }

  async setAllocation({ available, formulaNote, finalAmount }, reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    this._state.airdrop.allocationAvailable = Boolean(available);
    this._state.airdrop.allocationFormulaNote = formulaNote || null;

    try {
      const raw = this._storage.getItem(PLAYER_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        p.allocation = {
          available: Boolean(available),
          phase: this._state.airdrop.phase,
          eligiblePoints: available ? p.points : null,
          finalAmount: available && finalAmount != null ? Number(finalAmount) : null,
          formulaNote: formulaNote || null,
        };
        this._storage.setItem(PLAYER_KEY, JSON.stringify(p));
      }
    } catch { /* ignore */ }

    this._audit({
      action: 'airdrop.allocation',
      target: { type: 'airdrop', id: 'allocation', label: 'Allocation' },
      reason: text,
      meta: { available: Boolean(available), finalAmount: finalAmount ?? null },
    });
    this._emit();
    return { ok: true };
  }

  async createTask(payload, reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const task = {
      id: uid('task'),
      enabled: true,
      completions: 0,
      pendingVerification: 0,
      ...payload,
    };
    this._state.tasks.push(task);
    this._audit({
      action: 'task.create',
      target: { type: 'task', id: task.id, label: task.title },
      reason: text,
      meta: { reward: `${task.rewardAmount} ${task.rewardType}` },
    });
    this._emit();
    return { ok: true, task };
  }

  async updateTask(id, patch, reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const task = this._state.tasks.find((t) => t.id === id);
    if (!task) return { ok: false, error: 'Task not found.' };
    const before = { ...task };
    Object.assign(task, patch);
    this._audit({
      action: 'task.update',
      target: { type: 'task', id, label: task.title },
      reason: text,
      meta: { changed: Object.keys(patch), before },
    });
    this._emit();
    return { ok: true };
  }

  async createAnnouncement(payload, reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MIN_REASON_LENGTH) {
      return { ok: false, error: `A reason of at least ${MIN_REASON_LENGTH} characters is required.` };
    }
    const item = { id: uid('ann'), createdAt: Date.now(), ...payload };
    this._state.communication.announcements.unshift(item);
    this._audit({
      action: 'communication.announce',
      target: { type: 'announcement', id: item.id, label: item.title },
      reason: text,
      meta: { audience: item.audience },
    });
    this._emit();
    return { ok: true, item };
  }

  /* ---------------------------------------------------------------- audit */
  _audit({ action, target, amount = null, reason = null, previousBalance = null, newBalance = null, meta = {} }) {
    this._state.audit.unshift({
      id: uid('aud'),
      action,
      actor: { id: this._state.profile.id, name: this._state.profile.name },
      target,
      amount,
      reason,
      previousBalance,
      newBalance,
      meta,
      createdAt: Date.now(),
    });
    this._state.audit = this._state.audit.slice(0, 2000);
  }

  /* ------------------------------------------------------------- analytics */
  metrics() {
    this._syncLocalPlayer();
    const users = this._state.users;
    const active24 = users.filter((u) => Date.now() - u.lastActiveAt < 86400000).length;
    const totalPoints = users.reduce((s, u) => s + u.points, 0);
    const circulating = this._state.ledger
      .filter((e) => e.direction === 'credit' && e.type !== 'reversal')
      .reduce((s, e) => s + e.amount, 0);
    const dayAgo = Date.now() - 86400000;
    const points24 = this._state.ledger
      .filter((e) => e.createdAt >= dayAgo && e.direction === 'credit')
      .reduce((s, e) => s + e.amount, 0);
    return {
      users: users.length,
      active24,
      suspended: users.filter((u) => u.status === 'suspended').length,
      verified: users.filter((u) => u.verified === 'verified').length,
      risky: users.filter((u) => u.risk >= 50).length,
      totalPoints,
      circulating,
      points24,
      ledgerEntries: this._state.ledger.length,
      auditEntries: this._state.audit.length,
      referrals: users.reduce((s, u) => s + u.referrals.count, 0),
      tasksCompleted: this._state.tasks.reduce((s, t) => s + t.completions, 0),
      pendingVerification: this._state.tasks.reduce((s, t) => s + t.pendingVerification, 0),
    };
  }

  activityFeed(limit = 40) {
    const items = this._state.ledger.slice(0, limit).map((e) => ({
      id: e.id,
      at: e.createdAt,
      kind: e.type,
      userId: e.userId,
      user: this.user(e.userId)?.handle || 'Unknown',
      text: `${e.direction === 'credit' ? '+' : '−'}${e.amount.toLocaleString()} · ${e.label}`,
    }));
    return items.sort((a, b) => b.at - a.at);
  }

  alerts() {
    this._syncLocalPlayer();
    const out = [];
    for (const u of this._state.users) {
      if (u.risk >= 80) {
        out.push({
          id: `risk_${u.id}`, severity: 'high', at: u.lastActiveAt, userId: u.id,
          title: `High risk score on ${u.handle}`,
          detail: `Risk ${u.risk}/100 — ${u.riskSignals.join(', ') || 'no signals recorded'}.`,
        });
      } else if (u.risk >= 50) {
        out.push({
          id: `risk_${u.id}`, severity: 'medium', at: u.lastActiveAt, userId: u.id,
          title: `Elevated risk on ${u.handle}`,
          detail: `Risk ${u.risk}/100 — ${u.riskSignals.join(', ') || 'review recommended'}.`,
        });
      }
    }
    if (this._state.airdrop.phase === 'mining' && this._state.airdrop.allocationAvailable) {
      out.push({
        id: 'phase_mismatch', severity: 'high', at: Date.now(), userId: null,
        title: 'Allocation is open during the Mining Phase',
        detail: 'Users can currently see an allocation. Set the phase to allocation or close it.',
      });
    }
    if (this._state.claim.enabled && !this._state.claim.contractAddress) {
      out.push({
        id: 'claim_no_contract', severity: 'high', at: Date.now(), userId: null,
        title: 'Claim is enabled without a contract address',
        detail: 'Disable claim or set the official claim contract before enabling it.',
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  health() {
    const mem = this._state.users.length * 24 + this._state.ledger.length * 12;
    return [
      { label: 'Storage', value: `${Math.round(mem / 1024)} KB`, state: 'ok' },
      { label: 'Ledger integrity', value: this._ledgerIntegrity(), state: this._ledgerIntegrity() === 'OK' ? 'ok' : 'warn' },
      { label: 'Audit log', value: `${this._state.audit.length} entries`, state: 'ok' },
      { label: 'Airdrop phase', value: this._state.airdrop.phase, state: 'ok' },
      { label: 'Claim', value: this._state.claim.enabled ? 'ENABLED' : 'inactive', state: this._state.claim.enabled ? 'warn' : 'ok' },
      { label: 'Maintenance', value: this._state.system.maintenanceMode ? 'ON' : 'off', state: this._state.system.maintenanceMode ? 'warn' : 'ok' },
    ];
  }

  /**
   * Walks the ledger and confirms every entry chains correctly. A production
   * server performs this same reconciliation against its own records.
   */
  _ledgerIntegrity() {
    const byUser = new Map();
    for (const e of [...this._state.ledger].sort((a, b) => a.createdAt - b.createdAt)) {
      const prev = byUser.get(e.userId);
      if (prev !== undefined && e.previousBalance !== prev) return 'MISMATCH';
      byUser.set(e.userId, e.newBalance);
    }
    return 'OK';
  }

  async exportReport(kind) {
    const rows = kind === 'ledger' ? this.ledger({ limit: 5000 })
      : kind === 'audit' ? this.audit({ limit: 5000 })
        : kind === 'users' ? this._state.users
          : this._state.ledger;
    return { kind, rows, generatedAt: Date.now() };
  }
}

/* ==========================================================================
   ApiAdminStore — production seam
   --------------------------------------------------------------------------
   Drop-in replacement: `new ApiAdminStore({ baseUrl: '/api/admin' })`.
   Every method mirrors the same name and shape as LocalAdminStore so the UI
   needs no changes. It is intentionally unimplemented here rather than
   half-implemented, because a browser-only admin is not a security boundary.
   ========================================================================== */
export class ApiAdminStore {
  constructor({ baseUrl = '/api/admin', fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this._fetch = fetchImpl;
    this._listeners = new Set();
  }

  /** All calls must send the session cookie; never a token from localStorage. */
  async _request(path, { method = 'GET', body } = {}) {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `Request failed (${res.status})` };
    return res.json();
  }

  async init() { throw new Error('ApiAdminStore.init not implemented — see ADMIN_API for the contract.'); }
  get state() { return null; }
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  /* eslint-disable class-methods-use-this */
  async signIn(passcode) { return this._request('/session', { method: 'POST', body: { passcode } }); }
  async signOut() { return this._request('/session', { method: 'DELETE' }); }

  async adjustPoints({ userId, direction, amount, reason }) {
    return this._request(`/users/${encodeURIComponent(userId)}/points`, {
      method: 'POST',
      body: { direction, amount, reason, idempotencyKey: uid('idem') },
    });
  }
  async reverseLedgerEntry(id, reason) {
    return this._request(`/ledger/${encodeURIComponent(id)}/reverse`, {
      method: 'POST', body: { reason, idempotencyKey: uid('idem') },
    });
  }
  async setUserStatus(userId, status, reason) {
    return this._request(`/users/${encodeURIComponent(userId)}/status`, { method: 'POST', body: { status, reason } });
  }
  async setUserFlag(userId, flag, value, reason) {
    return this._request(`/users/${encodeURIComponent(userId)}/flags`, { method: 'POST', body: { flag, value, reason } });
  }
  async updateMining(patch, reason) { return this._request('/mining', { method: 'PUT', body: { ...patch, reason } }); }
  async updateSettings(section, patch, reason) { return this._request(`/${section}`, { method: 'PUT', body: { ...patch, reason } }); }
  async setAirdropPhase(phase, reason) { return this._request('/airdrop/phase', { method: 'POST', body: { phase, reason } }); }
  async setAllocation(payload, reason) { return this._request('/airdrop/allocation', { method: 'POST', body: { ...payload, reason } }); }
  async createTask(payload, reason) { return this._request('/tasks', { method: 'POST', body: { ...payload, reason } }); }
  async updateTask(id, patch, reason) { return this._request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...patch, reason } }); }
  async createAnnouncement(payload, reason) { return this._request('/announcements', { method: 'POST', body: { ...payload, reason } }); }
  /* eslint-enable class-methods-use-this */
}
