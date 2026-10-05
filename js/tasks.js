/* ==========================================================================
   $LGL Miner — Tasks screen
   Renders CONFIG.tasks, tracks progress, and claims rewards exactly once
   (unless a task is explicitly configured as repeatable).
   ========================================================================== */

import { CONFIG, rewardLabel } from './config.js';
import { icon } from './icons.js';
import { $, $$, esc, fmtInt, toast, haptic, on } from './ui.js';
import { sfx } from './feedback.js';

export class TasksView {
  /** @param {import('./store.js').Store} store */
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
          <h1 class="h1">Tasks</h1>
          <p class="subtle">Complete eligible activity to earn LGL Points and bonuses.</p>
        </div>

        <div class="notice notice--blue">
          ${icon('info')}
          <div>
            <strong>Task rewards.</strong>
            ${esc(CONFIG.copy.tasksNotice)}
            Completing a task does not by itself guarantee a $LGL allocation — final
            eligibility follows the official airdrop rules.
          </div>
        </div>

        <div class="grid grid--2" id="task-list"></div>

        <section class="card">
          <div class="card__head">
            ${icon('shield-check')}
            <h2 class="h2">Reward integrity</h2>
          </div>
          <p class="subtle tiny" style="margin:0">
            In production every task claim is verified by the server before a
            reward is credited. This prototype mirrors those rules locally so the
            interface behaves correctly; it is not a security boundary.
          </p>
        </section>
      </div>`;

    this._list = $('#task-list', root);
    this._render();

    this._disposers.push(on(this._list, 'click', (e) => this._onClick(e)));
    this._disposers.push(on(this._list, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const btn = e.target.closest('[data-claim]');
        if (btn) { e.preventDefault(); this._onClick({ target: btn }); }
      }
    }));
  }

  destroy() {
    this._disposers.forEach((fn) => fn());
    this._disposers = [];
    this._mounted = false;
  }

  /* ------------------------------------------------------------ rendering */
  _render() {
    if (!this._list) return;
    this._list.innerHTML = CONFIG.tasks.map((t) => this._taskCard(t)).join('');
  }

  _taskCard(task) {
    const status = this.store.taskStatus(task);
    const pct = Math.round((status.progress / status.target) * 100);
    const accent = task.accent || 'blue';

    const claimVariant = ['primary', 'purple', 'blue', 'orange', 'cyan'].includes(accent)
      ? (accent === 'blue' ? 'blue' : accent)
      : 'primary';

    const actionHtml = status.done
      ? `<span class="badge badge--green">${icon('check-circle')} Done</span>`
      : status.claimable
        ? `<button class="btn btn--${claimVariant} btn--sm" type="button" data-claim="${esc(task.id)}">
             ${icon('seal-check')} Claim
           </button>`
        : task.action?.type === 'link'
          ? `<button class="btn btn--outline-${esc(accent)} btn--sm" type="button" data-open-task="${esc(task.id)}">
               ${icon('link')} Open
             </button>`
          : `<button class="btn btn--ghost btn--sm" type="button" disabled aria-disabled="true">
               ${icon('clock')} In progress
             </button>`;

    return `
      <article class="task ${status.done ? 'is-done' : ''}" aria-labelledby="task-${esc(task.id)}">
        <div class="task__icon task__icon--${esc(accent)}">${icon(task.icon)}</div>
        <div class="task__body">
          <div class="task__title" id="task-${esc(task.id)}">${esc(task.title)}</div>
          <p class="task__desc">${esc(task.description)}</p>

          <div class="task__meta">
            <span class="task__reward ${task.reward.type === 'energy' ? 'task__reward--purple' : ''}">${esc(rewardLabel(task.reward))}</span>
            <span class="badge">${task.daily ? 'Daily' : 'One-time'}</span>
          </div>

          <div class="task__progress">
            <div class="bar bar--${esc(accent)}" role="progressbar"
                 aria-label="Progress for ${esc(task.title)}"
                 aria-valuemin="0" aria-valuemax="${status.target}"
                 aria-valuenow="${status.progress}">
              <div class="bar__fill" style="width:${pct}%"></div>
            </div>
            <span>${fmtInt(Math.min(status.progress, status.target))} / ${fmtInt(status.target)}</span>
          </div>
        </div>
        <div class="task__action">${actionHtml}</div>
      </article>`;
  }

  /* -------------------------------------------------------------- actions */
  async _onClick(e) {
    const claimBtn = e.target.closest('[data-claim]');
    const openBtn = e.target.closest('[data-open-task]');

    if (claimBtn) {
      const id = claimBtn.dataset.claim;
      claimBtn.disabled = true; // guard against double-tap before re-render
      const res = await this.store.claimTask(id);
      if (!res.ok) {
        toast(res.message || 'Could not claim that task.', 'warn');
        sfx.warn();
      } else {
        const task = CONFIG.tasks.find((t) => t.id === id);
        const label = rewardLabel(task?.reward);
        // Rewards are LGL Points during the Mining Phase — never "$LGL".
        toast(`${label} earned. Task completed.`, 'success');
        haptic(16);
        sfx.success();
      }
      this._render();
      return;
    }

    if (openBtn) {
      const task = CONFIG.tasks.find((t) => t.id === openBtn.dataset.openTask);
      if (!task) return;

      if (task.action?.type === 'rewarded-ad') {
        this.handlers.onOpenRewardedAd?.();
        return;
      }
      if (task.action?.href === '#friends') {
        this.handlers.onGoFriends?.();
        return;
      }
      if (task.action?.href) {
        // Marks local progress, then opens the destination.
        await this.store.completeTaskAction(task.id);
        window.open(task.action.href, '_blank', 'noopener,noreferrer');
        this._render();
      }
    }
  }

  /** Called when app state changes elsewhere (e.g. a rewarded ad was watched). */
  update() {
    this._render();
  }
}
