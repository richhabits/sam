// "Make it stop" detection — typed or spoken.
//
// When a reply runs away or loops ("hello hello hello…"), the user's instinct is to say
// "stop", "shut up", "be quiet", "you're not listening". SAM must treat that as an
// INTERRUPT — halt the reply, stop talking, stop listening — and NOT forward it to the
// brain (which would just add another turn to the pile-up). This detector decides that.
//
// Deliberately conservative: it only fires when the WHOLE message is a stop command, so a
// real request that merely contains the word ("how do I stop a docker container?",
// "don't stop believing") never triggers it.

const STOP_PHRASE = new RegExp(
  "^(?:" +
    "stop(?: it| now| already| everything| talking| listening| please)?" + // stop / stop it / stop talking…
    "|shut ?up(?: sam)?|shut it|shurrup|shtup" +                           // shut up / shut it
    "|shush|hush|be quiet|quiet(?: down| please)?|silence|silent" +        // quiet family
    "|zip it|pipe down|knock it off|cut it out|cut it|give it a rest" +    // idioms
    "|leave it|drop it|let it go|that s enough|enough(?: now| already)?" +
    "|cancel|abort|halt|nvm|never ?mind" +
    "|(?:you|u|ya|yah)(?: re| are| r)?(?: just)? ?(?:not|aint|ain t|no) ?listening" + // you're not listening
    "|not listening|stop not listening" +
  ")$",
  "i",
);

/** True when `raw` is (essentially) a command to stop — not a normal request. */
export function isStopCommand(raw: string): boolean {
  if (!raw) return false;
  let s = raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")    // apostrophes/emoji/punctuation/digits → spaces ("that's" → "that s")
    .replace(/(.)\1{2,}/g, "$1")  // squash elongation: "stopppp" → "stop", "shhh" → "sh"
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  // Strip leading vocatives / fillers, repeatably ("oh just sam stop" → "stop").
  s = s.replace(/^(?:(?:ok(?:ay)?|please|pls|oi+|hey|yo+|no+|nah|just|oh|argh|ugh|omg|sam|damn|god)\b\s*)+/g, "").trim();
  // Strip trailing vocatives / fillers, repeatably ("stop sam please" → "stop").
  s = s.replace(/(?:\s*\b(?:sam|please|pls|now|already|man|dude|mate|ok(?:ay)?))+$/g, "").trim();
  // Collapse a repeated word ("stop stop stop" → "stop").
  s = s.replace(/\b(\w+)(?: \1\b)+/g, "$1").trim();
  if (!s) return false;
  return STOP_PHRASE.test(s);
}
