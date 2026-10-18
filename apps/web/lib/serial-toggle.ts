export interface ToggleState {
  /** What the switch should end up as. Presses only move this. */
  wanted: boolean;
  /** What the bot last confirmed. */
  confirmed: boolean;
}

export type ToggleAnswer = { ok: true } | { ok: false; detail: string };

export interface ToggleOutcome {
  changed: boolean;
  failure?: { target: boolean; detail: string };
}

/**
 * Carries the wanted state to the bot one request at a time. A press made
 * while a request is in flight only moves `wanted`; the loop sends it after,
 * so answers cannot arrive out of order and the last press is what the bot
 * ends with. On a refusal `wanted` falls back to what the bot confirmed.
 */
export async function settleToggle(state: ToggleState, send: (target: boolean) => Promise<ToggleAnswer>): Promise<ToggleOutcome> {
  let changed = false;
  while (state.wanted !== state.confirmed) {
    const target = state.wanted;
    const answer = await send(target);
    if (!answer.ok) {
      state.wanted = state.confirmed;
      return { changed, failure: { target, detail: answer.detail } };
    }
    state.confirmed = target;
    changed = true;
  }
  return { changed };
}
