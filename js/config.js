/* ==========================================================================
   $LGL Miner — Central configuration
   --------------------------------------------------------------------------
   Every tunable value lives here. Nothing in this file is a promise about
   token economics — it only describes the points/UX behaviour of the app.
   ========================================================================== */

/**
 * Formats an ISO instant as a long UTC date, e.g. "March 1, 2027".
 * Kept local so the launch date can be derived from a single value without
 * making config depend on the UI layer.
 */
function utcDateLabel(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

/** The single source of truth for the target $LGL launch instant. */
const LAUNCH_ISO = '2027-03-01T00:00:00Z';

export const CONFIG = {
  app: {
    name: '$LGL Miner',
    shortName: 'LGL Miner',
    tagline: 'Lagos Life Airdrop Mining',
    /** Public production origin. Used to build referral links. */
    origin: 'https://lgl-miner.vercel.app',
    /** Referral query-parameter key: https://…/?ref=CODE */
    refParam: 'ref',
  },

  /* ------------------------------------------------------------------
     Authentication (prototype).

     The prototype keeps one account registry in this browser and stores a
     salted SHA-256 hash of the passcode — never the passcode itself. This is
     NOT a security boundary: localStorage is readable and editable by anyone
     with devtools. Production must issue an httpOnly session cookie from the
     server and re-authorise every request (see README → Authentication).
     ------------------------------------------------------------------ */
  auth: {
    /** Minimum passcode length accepted by the sign-up form. */
    minPasscodeLength: 8,
    /** How long a signed-in session lasts before it must be re-entered. */
    sessionDays: 30,
  },

  /* ------------------------------------------------------------------
     Android packaging (Profile → Download Android app).

     Uses the public PWABuilder cloud packager — the same service
     pwabuilder.com uses. It fetches the DEPLOYED site, so the button only
     works once the app is live on a public HTTPS URL (not localhost).
     ------------------------------------------------------------------ */
  android: {
    /** PWABuilder cloud packager endpoint. */
    packagerUrl: 'https://pwabuilder-cloudapk.azurewebsites.net/generateAppPackage',
    /** Reverse-DNS application id. Change before publishing to Play. */
    packageId: 'app.lagoslife.lglminer',
    appVersion: '1.0.0.0',
    appVersionCode: 1,
    /** Fallback icon when the manifest does not expose one. */
    iconPath: 'assets/icons/icon-512.png',
    themeColor: '#000000',
    backgroundColor: '#000000',
    /**
     * Optional Android signing key. Leave null for an UNSIGNED apk (fine for
     * testing / re-signing, or upload the .aab to Google Play). To ship a
     * signed apk, supply:
     *   { file: '<base64 .keystore>', alias, storePassword, keyPassword,
     *     fullName, organization, organizationalUnit, countryCode }
     */
    signing: null,
  },

  /* ------------------------------------------------------------------
     Target $LGL token launch.
     This is a TARGET date. If Lagos Life officially announces a change,
     update this single value — every countdown and label follows it.
     ------------------------------------------------------------------ */
  launch: {
    targetISO: LAUNCH_ISO,
    /** Short UTC date, derived from targetISO — never edit by hand. */
    dateLabel: utcDateLabel(LAUNCH_ISO),
    label: `Target $LGL Token Launch: ${utcDateLabel(LAUNCH_ISO)}`,
    disclaimer:
      'This is the current target date and may change. Any change will be announced through official Lagos Life channels.',
  },

  /* ------------------------------------------------------------------
     Mining economy. `perTap` is the base rate; the effective rate is
     perTap × multiplier. Production must recompute this server-side.
     ------------------------------------------------------------------ */
  mining: {
    perTap: 1,            // base LGL Points per tap
    defaultMultiplier: 1, // ×1 for all users until a real boost is earned
    maxEnergy: 1000,      // maximum energy (the tank holds 1000)
    energyPerTap: 1,      // energy consumed per tap
    /**
     * Energy refills continuously from empty back to max over this window.
     * 3600s = a full 1000-energy refill every hour, i.e. ~0.278 energy/sec.
     */
    energyRefillSeconds: 3600,
    /** Maximum taps the client will accept in one burst before throttling. */
    maxTapsPerSecond: 20,
  },

  /* ------------------------------------------------------------------
     Tap feedback. Haptics are best-effort and silently ignored where the
     Vibration API is unavailable (iOS Safari, desktop).
     ------------------------------------------------------------------ */
  feedback: {
    hapticMs: 12,        // vibration duration per tap
    hapticClaimMs: 24,   // vibration for a reward claim
    floatDurationMs: 900,// how long a "+1" popup lives
    logoPressMs: 300,    // logo zoom-out/zoom-in duration
  },

  /* ------------------------------------------------------------------
     Claimable rewards.
     ------------------------------------------------------------------ */
  rewards: {
    dailyBonusPoints: 100,   // once per calendar day
    rewardedAdEnergy: 25,    // simulated rewarded-ad grant
    referralPoints: 500,     // points credited to referrer on a VALID referral
    refereeBonusPoints: 100, // welcome points for the invited user
  },

  /* ------------------------------------------------------------------
     Task definitions. `repeatable: false` means the reward can be
     claimed exactly once. Progress is evaluated against app state for
     the prototype; production should evaluate it server-side.
     ------------------------------------------------------------------ */
  tasks: [
    {
      id: 'daily-mining',
      icon: 'hammer',
      accent: 'green',
      title: 'Daily Mining Session',
      description: 'Mine at least 20 points today.',
      reward: { type: 'points', amount: 50 },
      target: 20,
      /** Reads a progress value from app state. */
      progress: (s) => s.today.pointsEarned,
      repeatable: false,
      /** Tasks that reset on a new calendar day. */
      daily: true,
    },
    {
      id: 'explore-lagos-life',
      icon: 'globe',
      accent: 'blue',
      title: 'Explore Lagos Life',
      description: 'Visit the project community space.',
      reward: { type: 'points', amount: 100 },
      target: 1,
      progress: (s) => (s.tasks.exploredCommunity ? 1 : 0),
      repeatable: false,
      daily: false,
      /** Opens an external link instead of toggling state. */
      action: { type: 'link', href: 'https://lagoslife.example/community' },
    },
    {
      id: 'rewarded-ad',
      icon: 'play-circle',
      accent: 'purple',
      title: 'Rewarded Advertisement',
      description: 'Watch an eligible rewarded advertisement.',
      reward: { type: 'energy', amount: 25 },
      target: 1,
      progress: (s) => (s.tasks.watchedAdToday ? 1 : 0),
      repeatable: false,
      daily: true,
      action: { type: 'rewarded-ad' },
    },
    {
      id: 'invite-friend',
      icon: 'users',
      accent: 'orange',
      title: 'Invite a Friend',
      description: 'Share your referral link with one new person.',
      reward: { type: 'points', amount: 500 },
      target: 1,
      progress: (s) => (s.referrals.count > 0 ? 1 : 0),
      repeatable: false,
      daily: false,
      action: { type: 'link', href: '#friends' },
    },
  ],

  /* ------------------------------------------------------------------
     Airdrop display. Nothing here invents token supply, price, snapshot
     dates or allocations. Values are placeholders until officially set.
     ------------------------------------------------------------------ */
  airdrop: {
    /** Current project phase, shown as STATUS. */
    status: 'Mining Phase',
    /** Every figure below stays a placeholder until officially published. */
    allocation: 'Not available yet',
    snapshot: 'Not available yet',
    finalAllocation: 'Not available yet',
    claim: 'Not available yet',
    wallet: 'Required at claim',
    notice:
      'Keep earning LGL Points. Your eventual $LGL allocation will be determined during ' +
      'the official allocation phase according to the published airdrop rules and snapshot process.',
    tokenomicsMessage:
      "Official tokenomics will be published through Lagos Life's official channels.",
  },

  /* ------------------------------------------------------------------
     $LGL CONVERSION — READ THIS BEFORE CHANGING ANYTHING HERE.

     During the Mining Phase there is NO conversion and NO value assigned
     to LGL Points. This block is display-only copy. The frontend must
     NEVER derive a $LGL amount from a points balance.

     `available` and `display` below are the DEFAULT (unavailable) values.
     In production the backend/admin system overrides them at runtime —
     see `state.allocation` in store.js and `AirdropView._renderConversion()`.
     Nothing here may ever contain a conversion rate or formula.
     ------------------------------------------------------------------ */
  conversion: {
    /** Master switch. Only the backend may set this to true. */
    available: false,
    /** Default phase id when state.allocation.phase is absent. */
    phase: 'mining',
    /** Shown in place of any figure while unavailable. */
    display: 'Not available yet',
    message:
      'Keep earning LGL Points. The official $LGL allocation and conversion formula will be ' +
      'announced during the appropriate airdrop phase.',

    /**
     * The phase model. `id` must match state.allocation.phase.
     *
     * NOTE the deliberate absence of any "LGL Points → Lagos Life virtual
     * currency" step. The Lagos Life game's internal currency is separate and
     * has no defined relationship to LGL Points. Do not add such a step unless
     * an official integration explicitly introduces one.
     */
    phases: [
      {
        id: 'mining',
        label: 'Mining Phase',
        detail: 'Mining / Tasks / Referrals → LGL Points',
        note: 'No current conversion',
      },
      {
        id: 'allocation',
        label: 'Snapshot & Allocation Phase',
        detail: 'Eligible LGL Points → Official allocation calculation → Final $LGL allocation',
        note: 'Future',
      },
      {
        id: 'claim',
        label: 'Launch / Claim Phase',
        detail: 'Final $LGL allocation → Claim / token utility according to official rules',
        note: 'Future',
      },
      {
        id: 'integration',
        label: 'Lagos Life Integration',
        detail: '$LGL → Lagos Life ecosystem utility',
        note: 'Future',
      },
    ],
  },

  /* ------------------------------------------------------------------
     Points ≠ tokens disclaimer. Rendered in multiple places verbatim.
     ------------------------------------------------------------------ */
  disclaimer:
    'LGL Points are not $LGL tokens. Points currently have no exchange or withdrawal function. ' +
    'Your final $LGL allocation will be determined according to the official airdrop rules and snapshot.',

  /* ------------------------------------------------------------------
     The long-form legal disclaimer. Rendered in Terms and About. Keep it
     verbatim wherever it appears — it is the canonical wording.
     ------------------------------------------------------------------ */
  legalDisclaimer:
    'LGL Points are mining and participation points. They are not currently $LGL tokens and do ' +
    'not currently have a displayed monetary or token conversion value. LGL Points cannot ' +
    'currently be withdrawn, exchanged, or traded. Any future $LGL allocation will be ' +
    'determined according to the official allocation rules, eligibility requirements, and ' +
    'snapshot process.',

  /* ------------------------------------------------------------------
     Phase-aware informational copy. Every section pulls its wording from
     here so desktop, mobile, modals, toasts and empty states stay identical.
     ------------------------------------------------------------------ */
  copy: {
    pointsNotice:
      'You are currently earning LGL Points during the Mining Phase. The official $LGL ' +
      'allocation and conversion formula will be announced during the appropriate airdrop phase.',

    tasksNotice: 'Task rewards are currently issued as LGL Points only.',

    referralNotice:
      'Referral rewards are currently awarded as LGL Points. They are not direct $LGL ' +
      'payments or token distributions during the Mining Phase.',

    leaderboardTitle: 'LGL Points Leaderboard',
    leaderboardNotice: 'Rankings are based on accumulated LGL Points during the Mining Phase.',

    walletNotice:
      'Wallet connection will be used for eligible $LGL claim or token-related functionality ' +
      'when officially enabled.',

    aboutMiner:
      '$LGL Miner is the participation and points-mining platform for the Lagos Life ecosystem. ' +
      'During the Mining Phase, users earn LGL Points through mining, tasks, referrals, and ' +
      'other eligible activities.\n\n' +
      '$LGL is planned as a token within the wider Lagos Life ecosystem. LGL Points are not ' +
      'currently $LGL tokens and do not currently have a displayed conversion value.\n\n' +
      'At the appropriate future stage, eligible LGL Points will be considered through the ' +
      'official snapshot and allocation process. The final $LGL allocation and applicable ' +
      'formula will be announced officially before allocation.',

    /** Short reinforcement used under the mining balance. */
    keepMining: 'Keep mining for the future allocation.',
  },

  /* ------------------------------------------------------------------
     FAQ. Kept in config so copy can be reviewed and translated in one place.
     ------------------------------------------------------------------ */
  faq: [
    {
      q: 'What are LGL Points?',
      a: 'LGL Points are the current mining and participation points earned through activities on $LGL Miner.',
    },
    {
      q: 'Are LGL Points currently $LGL?',
      a: 'No. LGL Points are not currently $LGL tokens and do not currently have a displayed conversion value.',
    },
    {
      q: 'How will LGL Points become $LGL?',
      a: 'At the appropriate future stage, eligible LGL Points will be considered through the official snapshot and allocation process. The applicable formula and rules will be announced officially.',
    },
    {
      q: 'Can I currently withdraw or trade my LGL Points?',
      a: 'No. LGL Points are currently mining/participation points and are not currently available for withdrawal, exchange, or trading.',
    },
    {
      q: 'What is $LGL?',
      a: '$LGL is the planned token of the wider Lagos Life ecosystem and is intended to provide token-based utility within that ecosystem when officially launched and enabled.',
    },
    {
      q: 'When will $LGL be available?',
      a: 'The current target launch date is March 1, 2027. Any launch, allocation, claim, or token utility remains subject to the official project rollout.',
    },
    {
      q: 'What is my LGL Points balance worth in $LGL?',
      a: 'Not available yet. During the Mining Phase there is no LGL Points to $LGL exchange rate, and no conversion or value is calculated or displayed anywhere in this app. The official $LGL allocation and conversion formula will be announced during the appropriate airdrop phase.',
    },
    {
      q: 'Are my points guaranteed to become tokens?',
      a: 'No. Final allocation depends on the official rules, eligibility requirements and snapshot.',
    },
    {
      q: 'Can I mine actual blockchain tokens in my browser?',
      a: 'No. $LGL Miner tracks application points. It does not perform proof-of-work blockchain mining.',
    },
    {
      q: 'How is my eligibility determined?',
      a: 'Eligibility is determined by official airdrop rules. Eligible activity is recorded, an official snapshot is taken, eligibility is verified, and final allocations are calculated. Completing an action in this app does not by itself guarantee an allocation.',
    },
    {
      q: 'Do I need a wallet?',
      a: 'A wallet will be required at the claim phase, after the token launch. Wallet connection will be used for eligible $LGL claim or token-related functionality when officially enabled. Do not send funds to anyone claiming to be from the project.',
    },
    {
      q: 'Is $LGL the same as the Lagos Life game currency?',
      a: 'No. The Lagos Life game has its own internal virtual currency, which is separate from LGL Points and from $LGL. No relationship between them has been announced. $LGL is intended for use within the wider Lagos Life ecosystem when officially launched and enabled.',
    },
  ],

  /* ------------------------------------------------------------------
     Roadmap. Dates are planned / target dates.
     ------------------------------------------------------------------ */
  roadmap: [
    {
      when: 'Q4 2026 — Foundation',
      what: 'Foundation',
      items: ['Tokenomics', 'Miner', 'Airdrop system', 'Anti-bot/security', 'Community'],
      tone: '',
    },
    {
      when: 'January 2027 — Mining & Growth',
      what: 'Mining & Growth',
      items: ['Daily mining', 'Tasks', 'Referrals', 'Leaderboards', 'Campaigns'],
      tone: 'next',
    },
    {
      when: 'February 2027 — Final Airdrop Phase',
      what: 'Final Airdrop Phase',
      items: ['Final mining', 'Eligibility verification', 'Anti-cheat review', 'Snapshot'],
      tone: 'next',
    },
    {
      when: 'March 1, 2027 — $LGL Token Launch',
      what: '$LGL Token Launch',
      items: ['Planned token launch', 'Claim phase'],
      tone: 'launch',
    },
    {
      when: 'Post-launch',
      what: 'Post-launch',
      items: ['Lagos Life ecosystem utility', 'Partnerships', 'Additional use cases'],
      tone: '',
    },
  ],
};

/**
 * Human-readable reward label, e.g. "+50 LGL Points" or "+25 Energy".
 *
 * Rewards are LGL Points during the Mining Phase, so they are labelled as
 * such. Never label a Mining Phase reward as "$LGL".
 */
export function rewardLabel(reward) {
  if (!reward) return '';
  if (reward.type === 'energy') return `+${reward.amount} Energy`;
  return `+${reward.amount} LGL Points`;
}

/** Builds a referral URL for a code. */
export function referralUrl(code) {
  return `${CONFIG.app.origin}/?${CONFIG.app.refParam}=${encodeURIComponent(code)}`;
}
