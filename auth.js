/* ==========================================================================
   $LGL Miner — Authentication screen
   --------------------------------------------------------------------------
   Sign-in / sign-up gate shown before the app shell is revealed.

   SECURITY MODEL
     · The prototype (LocalStore) keeps accounts in this browser and stores a
       salted hash of the passcode — never the passcode. It is NOT a security
       boundary; a user with devtools can read or edit it.
     · Production (ApiStore) posts to /api/auth/* and relies on an httpOnly,
       SameSite session cookie set by the server. No token is ever held in JS.
   The UI here is identical for both — it only talks to the Store interface.
   ========================================================================== */

import { CONFIG } from './config.js';
import { icon, logoMark } from './icons.js';
import { $, on } from './ui.js';

const COPY = {
  signin: {
    tab: 'Sign in',
    title: 'Welcome back',
    lead: 'Sign in to continue mining LGL Points.',
    submit: 'Sign in',
    passcodeAutocomplete: 'current-password',
  },
  signup: {
    tab: 'Create account',
    title: 'Create your account',
    lead: 'Start earning LGL Points toward the Lagos Life airdrop.',
    submit: 'Create account',
    passcodeAutocomplete: 'new-password',
  },
};

export class AuthView {
  /** @param {import('./store.js').Store} store */
  constructor(store, handlers = {}) {
    this.store = store;
    this.handlers = handlers;
    this.mode = 'signin';
    this._busy = false;
    this._disposers = [];
    this._mounted = false;
  }

  /* ---------------------------------------------------------------- mount */
  mount(root) {
    if (this._mounted) return;
    this._mounted = true;
    this.root = root;
    root.innerHTML = this._template();

    this._refs = {
      form: $('#auth-form', root),
      tabs: Array.from(root.querySelectorAll('[data-auth-tab]')),
      title: $('#auth-title', root),
      lead: $('#auth-lead', root),
      email: $('#auth-email', root),
      passcode: $('#auth-passcode', root),
      confirmField: $('#auth-confirm-field', root),
      confirm: $('#auth-confirm', root),
      error: $('#auth-error', root),
      submit: $('#auth-submit', root),
      hint: $('#auth-hint', root),
    };

    this._bind();
    this._syncMode();
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    this._mounted = false;
  }

  /** Clears the form and returns to sign-in (called after sign-out). */
  reset() {
    if (!this._refs) return;
    this._refs.form?.reset();
    this._setError(null);
    this._setMode('signin');
    this.focusFirst();
  }

  focusFirst() {
    // Delay so the screen is visible before focus moves.
    setTimeout(() => this._refs?.email?.focus(), 60);
  }

  /* -------------------------------------------------------------- template */
  _template() {
    return `
      <div class="auth" role="main">
        <div class="auth__card">
          <div class="auth__brand">
            ${logoMark('auth__logo')}
            <div>
              <div class="auth__name">${CONFIG.app.name}</div>
              <div class="auth__sub">Lagos Life Airdrop</div>
            </div>
          </div>

          <div class="auth__tabs" role="tablist" aria-label="Authentication mode">
            <button class="auth__tab" type="button" role="tab"
                    data-auth-tab="signin" aria-selected="true">Sign in</button>
            <button class="auth__tab" type="button" role="tab"
                    data-auth-tab="signup" aria-selected="false">Create account</button>
          </div>

          <h1 class="auth__title" id="auth-title">Welcome back</h1>
          <p class="auth__lead" id="auth-lead">Sign in to continue mining LGL Points.</p>

          <form class="auth__form" id="auth-form" novalidate autocomplete="on">
            <label class="field">
              <span class="field__label">Email</span>
              <span class="field__wrap">
                ${icon('envelope-simple')}
                <input class="field__input" id="auth-email" name="email" type="email"
                       inputmode="email" autocomplete="email" spellcheck="false"
                       autocapitalize="off" placeholder="you@example.com" required>
              </span>
            </label>

            <label class="field">
              <span class="field__label">Passcode</span>
              <span class="field__wrap">
                ${icon('lock')}
                <input class="field__input" id="auth-passcode" name="passcode" type="password"
                       autocomplete="current-password"
                       placeholder="At least ${CONFIG.auth?.minPasscodeLength ?? 8} characters" required>
              </span>
            </label>

            <label class="field" id="auth-confirm-field" hidden>
              <span class="field__label">Confirm passcode</span>
              <span class="field__wrap">
                ${icon('lock')}
                <input class="field__input" id="auth-confirm" name="confirm" type="password"
                       autocomplete="new-password" placeholder="Re-enter your passcode">
              </span>
            </label>

            <p class="auth__error" id="auth-error" role="alert" aria-live="assertive" hidden></p>

            <button class="btn btn--primary btn--block auth__submit" type="submit" id="auth-submit">
              Sign in
            </button>
          </form>

          <p class="auth__hint tiny muted" id="auth-hint">
            Prototype accounts are stored only in this browser. No email is sent and
            no server is contacted. Never reuse a real password.
          </p>

          <p class="auth__legal tiny muted">
            LGL Points are not $LGL tokens and currently have no exchange or
            withdrawal function.
          </p>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------------- bindings */
  _bind() {
    const r = this._refs;

    r.tabs.forEach((tab) => {
      this._disposers.push(on(tab, 'click', () => this._setMode(tab.dataset.authTab)));
    });

    this._disposers.push(on(r.form, 'submit', (e) => {
      e.preventDefault();
      this._submit();
    }));

    // Clear the error as soon as the user starts fixing their input.
    [r.email, r.passcode, r.confirm].forEach((input) => {
      if (input) this._disposers.push(on(input, 'input', () => this._setError(null)));
    });
  }

  /* ---------------------------------------------------------------- modes */
  _setMode(mode) {
    this.mode = COPY[mode] ? mode : 'signin';
    this._syncMode();
  }

  _syncMode() {
    const r = this._refs;
    if (!r) return;
    const copy = COPY[this.mode];

    r.tabs.forEach((tab) => {
      const active = tab.dataset.authTab === this.mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    r.title.textContent = copy.title;
    r.lead.textContent = copy.lead;
    r.submit.innerHTML = `${icon(this.mode === 'signup' ? 'user' : 'sign-in')} ${copy.submit}`;
    r.passcode.setAttribute('autocomplete', copy.passcodeAutocomplete);
    r.confirmField.hidden = this.mode !== 'signup';
    if (this.mode !== 'signup') r.confirm.value = '';
    this._setError(null);
  }

  _setError(message) {
    const el = this._refs?.error;
    if (!el) return;
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = message;
  }

  _setBusy(busy) {
    this._busy = busy;
    const r = this._refs;
    if (!r) return;
    r.submit.disabled = busy;
    r.submit.setAttribute('aria-busy', String(busy));
    if (busy) {
      r.submit.innerHTML = `${icon('arrow-clockwise')} Please wait…`;
    } else {
      const copy = COPY[this.mode];
      r.submit.innerHTML = `${icon(this.mode === 'signup' ? 'user' : 'sign-in')} ${copy.submit}`;
    }
  }

  /* --------------------------------------------------------------- submit */
  async _submit() {
    if (this._busy) return;
    const r = this._refs;
    const email = r.email.value;
    const passcode = r.passcode.value;

    // Client-side confirmation only; the store re-validates everything.
    if (this.mode === 'signup' && passcode !== r.confirm.value) {
      this._setError('The two passcodes do not match.');
      r.confirm.focus();
      return;
    }

    this._setError(null);
    this._setBusy(true);

    try {
      const result = this.mode === 'signup'
        ? await this.store.signUp({ email, passcode })
        : await this.store.signIn({ email, passcode });

      if (!result.ok) {
        this._setError(result.message || 'That did not work. Please try again.');
        if (result.error === 'email-taken') this._setMode('signin');
        return;
      }

      r.form.reset();
      this.handlers.onAuthenticated?.(result);
    } catch (err) {
      console.error('[auth] failed', err);
      this._setError("We couldn't sign you in. Please try again.");
    } finally {
      this._setBusy(false);
    }
  }
}
