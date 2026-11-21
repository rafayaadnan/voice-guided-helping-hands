import { createContext, useContext, type MutableRefObject } from "react";

import type { Strings } from "@/lib/humnazar/i18n";
import type { Helper, Lang, Role, SampleItemId } from "@/lib/humnazar/logic";
import type { CmdWord } from "@/lib/humnazar/voice-words";

export type ScreenId =
  | "A" | "L" | "B" | "D" | "QP" | "F" | "Q" | "G" | "T" | "H" | "M" | "R" | "CD" | "W" | "WA"
  | "Y" | "YC" | "YR" | "V1" | "V2x" | "V3" | "V5" | "VM" | "VT"
  | "WEL" | "VS" | "S2" | "S3" | "S4" | "S5";
export type Anim = "fwd" | "back" | "fade";
export type Mode = "quick" | "call" | "later";
/** Builds text for one language; speech may use English when no Urdu voice is installed. */
export type Say = (t: Strings, l: Lang) => string;
export type VoiceState = "unknown" | "ok" | "off";

export interface Request {
  number: string | null;
  photo: SampleItemId | null;
  widened: boolean;
  volunteerId: string | null;
}
export interface Session {
  /** True between Welcome > Sign up and the end of the blind-user setup. */
  signup: boolean;
  role: Role;
  lang: Lang;
  helper: Helper | null;
  lastMode: Mode | null;
  friends: string[];
  unavailable: Helper[];
  linkUsed: boolean;
  request: Request;
  askLater: { photo: SampleItemId | null; carried: boolean };
  askLaterNumber: string | null;
}

/** What a blind-user screen says after its caption and which spoken answers it accepts. */
export interface ScreenVoice {
  q?: Say;
  /** Checked first: a screen-specific parser (helper, photo, yes or no, rating). */
  parse?: (text: string) => (() => void) | null;
  /** Then these command words, in this order. */
  cmds?: Partial<Record<CmdWord, () => void>>;
  /** No "I did not hear you" retry (live call). */
  quiet?: boolean;
  /** Replaces caption + question speech (Choose language speaks both languages). */
  prompt?: () => Promise<boolean>;
  retry?: () => Promise<boolean>;
  listenLang?: (attempt: number) => Lang;
  /** Words to offer when something was heard but did not match: "I heard … Please say <options>." */
  options?: Say;
  /** Home: the word "cancel" does not go back there. */
  ignoreCancel?: boolean;
  /** Home and Ask Later sent: no "Say back to go back." at the end of the prompt. */
  noBackHint?: boolean;
}
/** full = caption + question, question = question only, listen = no speech. pre is spoken first. */
export interface AskOpts { mode?: "full" | "question" | "listen"; pre?: Say }
/** One listening loop shared by the confirm step and the screen's first command. */
export interface HearOpts<T> {
  lang?: Lang | ((attempt: number) => Lang) | undefined;
  /** Checked against every alternative transcript; the first non-null result wins. */
  match: (alt: string) => T | null;
  /** Spoken when nothing was heard (and, without heardRetry, when words did not match). */
  retry: () => Promise<boolean>;
  /** Spoken when words were heard but did not match. */
  heardRetry?: ((heard: string) => Promise<boolean>) | undefined;
  /** Never says "I did not hear you"; stops quietly instead. */
  quiet?: boolean | undefined;
  onListen?: ((on: boolean) => void) | undefined;
  onMiss?: ((heard: string) => void) | undefined;
}
export type HearResult<T> = { s: "hit"; hit: T; text: string } | { s: "fail" } | { s: "stop" };
export type Mic = { s: "idle" | "listening" | "heard" | "failed"; heard?: string };

export interface Ctx {
  t: Strings;
  lang: Lang;
  langRef: MutableRefObject<Lang>;
  setLang: (l: Lang) => void;
  s: Session;
  blind: boolean;
  set: (fn: (s: Session) => Session) => void;
  go: (to: ScreenId, opts?: { replace?: boolean; reset?: ScreenId[]; anim?: Anim }) => void;
  back: () => void;
  /** Spoken "back": goes to the previous screen; on Live call it first asks "End the call? Say confirm or cancel." */
  voiceBack: () => void;
  confirmEnd: () => void;
  say: (build: Say, langOverride?: Lang) => Promise<boolean>;
  /** Voice confirm: the first choice speaks what it does and listens for confirm or cancel; a second tap is a silent fallback. */
  press: (id: string, msg: Say, action: () => void, lang?: Lang) => void;
  armed: string | null;
  armListening: boolean;
  /** Repeats the current prompt (the armed confirm, or the screen question) and listens again. */
  tapRepeat: () => void;
  /** Asks the current screen's question again. */
  reask: (o?: AskOpts) => void;
  registerScreen: (fn: ((o?: AskOpts) => Promise<void>) | null) => void;
  /** Starts a new voice flow; older flows stop at their next step. */
  begin: () => number;
  isCurrent: (token: number) => boolean;
  clearArm: () => void;
  mic: Mic;
  setMic: (m: Mic) => void;
  voiceRef: MutableRefObject<VoiceState>;
  voice: VoiceState;
  markVoiceOff: () => Promise<void>;
  /** Microphone permission denied: shows and speaks the "Microphone is blocked" message once. */
  markBlocked: () => Promise<void>;
  blocked: boolean;
  markVoiceOk: () => void;
  hear: <T>(token: number, o: HearOpts<T>) => Promise<HearResult<T>>;
}

export const PrototypeContext = createContext<Ctx | null>(null);
export function useP(): Ctx {
  const c = useContext(PrototypeContext);
  if (!c) throw new Error("Prototype context missing");
  return c;
}
