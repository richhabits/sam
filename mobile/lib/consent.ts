import * as SecureStore from 'expo-secure-store';

// ASKING BEFORE IT SPENDS.
//
// SAM is free-first — it routes to a local or free brain before a paid one, and there is a live
// token meter. All of that is currently invisible POLICY: it happens correctly and the operator
// is told about it afterwards, in a route badge under the reply. The one moment where the
// promise is worth something — just before something costs money — has no moment at all.
//
// Emergent ships the shape this borrows: consent as an inline message in the thread rather than
// a modal, with a three-step ladder (decline / allow once / allow always), and it markets the
// result as "Asks before it acts. No surprise charges." SAM's claim is strictly stronger,
// because SAM's default genuinely is free, and it was making none of it.
//
// What is deliberately NOT borrowed is Manus's version. Its only cost message fires DURING a
// run — "has consumed more credits than usual, usage may continue to increase" — with no
// pre-flight estimate and no cap, and its reviewers are unanimous that this is the worst thing
// about the product. A cost warning that arrives while you are already spending is an alarm,
// not consent. Everything here happens BEFORE, or not at all.

const KEY = 'sam.spend.consent';

/** What SAM is allowed to do about paid brains without asking again. */
export type SpendConsent = 'ask' | 'always';

/**
 * Whether sending under this tier could cost money.
 *
 * `free` is the only honest "no": it selects models that cost nothing, so there is nothing to
 * consent to. `turbo` is an explicit request for the best available model and is the only tier
 * that reliably spends.
 *
 * `auto` is the interesting one and it returns FALSE on purpose. Auto tries free and local
 * brains first and reaches for paid only when free will not do — so prompting on every auto
 * send would put a spend warning in front of the case that usually costs nothing, which teaches
 * people to fear the default and to dismiss the prompt without reading it. A consent card that
 * fires when nothing is being spent is worse than no card: it is the thing that makes the real
 * one invisible.
 */
export function couldSpend(tier: string | null | undefined): boolean {
  return tier === 'turbo';
}

/**
 * Does this send need to stop and ask?
 *
 * Only when the tier could spend AND no standing permission has been given. Kept as a pure
 * function of the two inputs so the rule can be tested without a keychain, a thread or a
 * rendered screen.
 */
export function needsConsent(tier: string | null | undefined, consent: SpendConsent): boolean {
  return couldSpend(tier) && consent !== 'always';
}

/**
 * What the card says before it spends.
 *
 * Manus's genuinely good idea, kept: quantify the run in UNITS OF WORK rather than in money.
 * It says "About 6 background agent tasks will be running" and never states a price, which is
 * the right instinct badly finished — it quantifies scale and then leaves you to guess the
 * cost. SAM can do the thing Manus cannot, because SAM's default is free: it can name the
 * alternative. So the card says what this send will use AND what the free path would have been,
 * which turns a warning into a choice.
 *
 * No number is invented. SAM does not know what a turn will cost before it runs one, and a
 * made-up estimate is how a meter stops being believed.
 */
export function consentCopy(): { title: string; body: string } {
  return {
    title: 'This one uses paid credit',
    body: 'Turbo goes straight to the best model available. Auto would try your local and free brains first and only pay if they could not do it — the meter in Tasks shows what everything actually cost.',
  };
}

export async function loadConsent(): Promise<SpendConsent> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === 'always' ? 'always' : 'ask';
  } catch {
    // A keychain that will not answer must fail toward ASKING. The cautious direction here is
    // the one that spends nothing without a person saying so.
    return 'ask';
  }
}

export async function setConsent(value: SpendConsent): Promise<void> {
  try {
    if (value === 'always') await SecureStore.setItemAsync(KEY, 'always');
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* best-effort: a grant that fails to persist just means being asked again, which is safe */
  }
}
