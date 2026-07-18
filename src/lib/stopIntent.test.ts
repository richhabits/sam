import { describe, it, expect } from "vitest";
import { isStopCommand } from "./stopIntent.ts";

describe("isStopCommand — fires on a stop/interrupt utterance", () => {
  const yes = [
    "stop", "Stop", "STOP", "stop!", "stop.", "stop it", "stop it!", "stop now",
    "just stop", "please stop", "ok stop", "stop please", "stoppp", "stop stop stop",
    "sam stop", "stop sam", "sam, stop!", "no stop",
    "shut up", "shut up!", "shutup", "shut up sam", "oh shut up", "shut it",
    "shush", "hush", "quiet", "be quiet", "quiet down", "silence",
    "zip it", "pipe down", "knock it off", "cut it out", "give it a rest",
    "enough", "enough!", "that's enough", "enough now",
    "cancel", "abort", "halt", "nevermind", "never mind",
    "stop talking", "stop listening", "stop talking sam",
    "you're not listening", "you aint listening", "u aint listening",
    "u ain't listening", "you are not listening", "not listening", "ya not listening",
    "🤫 stop", "STOP!!!", "stopppp sam please",
  ];
  for (const s of yes) {
    it(`fires: ${JSON.stringify(s)}`, () => expect(isStopCommand(s)).toBe(true));
  }
});

describe("isStopCommand — does NOT fire on a real request that merely contains a word", () => {
  const no = [
    "", "   ", "hello", "how do I stop a docker container?",
    "don't stop believing", "write a poem about silence",
    "stop the war — draft me an essay", "how do I make it quiet in here",
    "what does 'cut it out' mean", "cancel my 3pm meeting tomorrow",
    "is enough sleep really 8 hours?", "explain the halt problem",
    "no", "nah", "ok", "okay", "yes", "why aren't you listening to the audio file",
    "listening to music recommendations please", "abort a git merge how",
  ];
  for (const s of no) {
    it(`ignores: ${JSON.stringify(s)}`, () => expect(isStopCommand(s)).toBe(false));
  }
});
