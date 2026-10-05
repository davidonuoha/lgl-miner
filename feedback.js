/* ==========================================================================
   $LGL Miner — Audio feedback
   --------------------------------------------------------------------------
   Short synthesised confirmation sounds that accompany the haptic buzz.

   Design notes:
     • No audio files. Every sound is generated with the Web Audio API, so
       there is nothing to download, cache or decode — important for the
       low-end Android target.
     • Nothing is created until the first sound is played, and every node is
       disconnected when it finishes, so an idle tab holds no audio resources.
     • Browsers block audio until a user gesture. `unlock()` must be called
       from a real gesture (we call it on the first pointerdown/keydown).
     • Fails silently and completely on unsupported browsers (and in tests,
       where AudioContext does not exist).
     • Respects the user's "Sound effects" setting via setEnabled().
   ========================================================================== */

/** Master switch, mirrored from state.settings.sound. */
let enabled = true;

/** Lazily-created AudioContext. */
let ctx = null;

/** Timestamp of the last tap blip, used to throttle rapid tapping. */
let lastTapAt = 0;

/** Minimum gap between tap blips. Below this they blur into noise. */
const TAP_THROTTLE_MS = 45;

/** Overall output level. Deliberately quiet — this sits under a tap game. */
const MASTER_GAIN = 0.5;

let master = null;

export function setEnabled(on) {
  enabled = Boolean(on);
}

export function isEnabled() {
  return enabled;
}

/**
 * Creates (once) and returns the AudioContext, or null when unsupported.
 * @returns {AudioContext|null}
 */
function audioContext() {
  if (ctx) return ctx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Resumes a suspended context. Must be called from a user gesture, otherwise
 * browsers keep the context suspended and no sound is heard.
 */
export function unlock() {
  const c = audioContext();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
}

/**
 * Plays a single enveloped tone.
 *
 * @param {object} opts
 * @param {number} opts.freq        Start frequency in Hz.
 * @param {number} [opts.to]        Optional frequency to glide to.
 * @param {number} opts.dur         Duration in seconds.
 * @param {OscillatorType} [opts.type]
 * @param {number} [opts.gain]      Peak gain (0–1).
 * @param {number} [opts.delay]     Start offset in seconds.
 */
function tone({ freq, to, dur, type = 'sine', gain = 0.06, delay = 0 }) {
  const c = audioContext();
  if (!c || !enabled) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);

  // Short attack, exponential decay — avoids clicks at both ends.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  env.connect(master || c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);

  osc.onended = () => {
    try {
      osc.disconnect();
      env.disconnect();
    } catch {
      /* already torn down */
    }
  };
}

/** Sound effects. Every call is safe to make unconditionally. */
export const sfx = {
  /** Per-tap tick. Throttled so rapid tapping stays pleasant. */
  tap() {
    const now = Date.now();
    if (now - lastTapAt < TAP_THROTTLE_MS) return;
    lastTapAt = now;
    // Small random pitch variation keeps repeated taps from sounding robotic.
    const freq = 1050 + Math.random() * 160;
    tone({ freq, to: freq * 0.82, dur: 0.045, type: 'triangle', gain: 0.035 });
  },

  /** Points / reward granted. */
  reward() {
    tone({ freq: 660, dur: 0.09, type: 'triangle', gain: 0.06 });
    tone({ freq: 990, dur: 0.14, type: 'triangle', gain: 0.055, delay: 0.075 });
  },

  /** Larger confirmation — task complete, bonus claimed. */
  success() {
    tone({ freq: 660, dur: 0.08, type: 'triangle', gain: 0.055 });
    tone({ freq: 880, dur: 0.08, type: 'triangle', gain: 0.055, delay: 0.07 });
    tone({ freq: 1320, dur: 0.16, type: 'triangle', gain: 0.05, delay: 0.14 });
  },

  /** Something needs attention — insufficient energy, already claimed. */
  warn() {
    tone({ freq: 340, to: 300, dur: 0.16, type: 'square', gain: 0.03 });
  },

  /** Action failed. */
  error() {
    tone({ freq: 220, to: 140, dur: 0.22, type: 'sawtooth', gain: 0.03 });
  },
};
