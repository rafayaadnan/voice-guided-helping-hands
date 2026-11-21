// Shared voice controller (Web Speech API): one speech queue and ONE reused SpeechRecognition
// for the whole app. Only call from effects or event handlers.
import { MASKED_CNIC, type Lang } from "./logic";

const RATE = 0.9;
/** Pause between the end of speech and the start of recognition. */
const AFTER_SPEECH_MS = 300;
/** How long to wait for a previous recognition to end after abort(). */
const END_WAIT_MS = 250;
const START_RETRY_MS = 300;
const START_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- Status line + console log (for evaluators) ---------- */

export type MicStatus =
  | { s: "idle" }
  | { s: "speaking" }
  | { s: "listening" }
  | { s: "heard"; text: string }
  | { s: "nomatch" }
  | { s: "error"; code: string };

let micStatus: MicStatus = { s: "idle" };
const micListeners = new Set<() => void>();
export function subscribeMic(fn: () => void): () => void {
  micListeners.add(fn);
  return () => micListeners.delete(fn);
}
export const getMic = (): MicStatus => micStatus;
const IDLE: MicStatus = { s: "idle" };
export const getMicServer = (): MicStatus => IDLE;

function setStatus(st: MicStatus): void {
  micStatus = st;
  micListeners.forEach((f) => f());
}

function vlog(state: string, extra: Record<string, unknown> = {}): void {
  if (typeof console !== "undefined") console.info("[voice]", { screen: activeScreen, state, ...extra });
}

let privateResults = false;
/** While on (the CNIC answer), heard text is masked on the status line and never written to the console. */
export function setPrivateListening(on: boolean): void {
  privateResults = on;
}
/** True while the CNIC answer is being heard: screens must show the mask, never the heard text. */
export function isPrivateListening(): boolean {
  return privateResults;
}

/** Screens report what they did with a result: matched a command, or not. showText keeps "heard '…'" on a mismatch. */
export function reportHeard(text: string, matched: boolean, showText = false): void {
  const shown = privateResults ? MASKED_CNIC : text;
  setStatus(matched || showText ? { s: "heard", text: shown } : { s: "nomatch" });
  vlog(matched ? "heard" : "no-match", { text: shown });
}

/* ---------- Screen ids ---------- */

let activeScreen = 0;
/** A blind-user screen opened: stops any speech and recognition and returns its id. */
export function openScreen(): number {
  activeScreen++;
  stopListening();
  cancelSpeech();
  setStatus(IDLE);
  vlog("screen-open");
  return activeScreen;
}
/** The screen closed: if it is still the current one, stop everything it started. */
export function closeScreen(id: number): void {
  vlog("screen-close", { closed: id });
  if (id !== activeScreen) return;
  activeScreen++;
  stopListening();
  cancelSpeech();
}

/* ---------- Speech ---------- */

let speakToken = 0;
/** Kept so the browser does not garbage-collect the utterance and drop its onend. */
let currentUtterance: SpeechSynthesisUtterance | null = null;
let lastSpeechEnd = 0;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

export function hasUrduVoice(): boolean {
  const s = synth();
  return !!s && s.getVoices().some((v) => v.lang.toLowerCase().startsWith("ur"));
}

export function cancelSpeech(): void {
  speakToken++;
  currentUtterance = null;
  synth()?.cancel();
}

/** Safety timer when onend never fires: 400 ms per word of the text, plus 1 second. */
export function speechSafetyMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words * 400 + 1000;
}

/** Speaks text; resolves true when it finished, false when it was cancelled or replaced. Stops recognition first. */
export function speak(text: string, lang: Lang): Promise<boolean> {
  stopListening();
  const s = synth();
  cancelSpeech();
  const token = speakToken;
  if (!s || !text) {
    lastSpeechEnd = Date.now();
    return Promise.resolve(true);
  }
  setStatus({ s: "speaking" });
  vlog("speaking", { text: text.slice(0, 60) });
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean, why: string) => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      const current = token === speakToken;
      if (current) {
        lastSpeechEnd = Date.now();
        currentUtterance = null;
        if (micStatus.s === "speaking") setStatus(IDLE);
      }
      vlog("speech-end", { why, current });
      resolve(ok && current);
    };
    const u = new SpeechSynthesisUtterance(text);
    currentUtterance = u;
    u.lang = lang === "ur" ? "ur-PK" : "en-US";
    u.rate = RATE;
    const voice = s.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang === "ur" ? "ur" : "en"));
    if (voice) u.voice = voice;
    u.onend = () => finish(true, "onend");
    u.onerror = (e) => finish(e.error !== "interrupted" && e.error !== "canceled", `onerror ${e.error}`);
    // Chrome sometimes never fires onend: continue anyway after the safety time.
    const safety = setTimeout(() => finish(true, "safety-timer"), speechSafetyMs(text));
    try {
      s.speak(u);
    } catch {
      finish(true, "speak-threw");
    }
  });
}

/* ---------- Recognition: one shared instance ---------- */

type RecEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Rec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type ListenResult =
  | { status: "ok"; text: string; alternatives: string[] }
  /** Ended with no usable result (no-speech, aborted by the browser, network, timeout…). */
  | { status: "nomatch"; code: string }
  /** Stopped by the app (new screen, speech, tap). */
  | { status: "aborted" }
  /** Microphone permission denied. */
  | { status: "blocked"; code: string }
  /** No speech recognition in this browser. */
  | { status: "unavailable" };

function recCtor(): (new () => Rec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return !!recCtor();
}

interface Session {
  idx: number;
  settle: (r: ListenResult) => void;
  onResult: (alts: string[]) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}

let rec: Rec | null = null;
/** Every successful start() gets an index; every onend closes the oldest open one (Chrome runs one at a time). */
let started = 0;
let ended = 0;
const sessions = new Map<number, Session>();
let endWaiters: (() => void)[] = [];
let current: Session | null = null;
/** Bumped by stopListening so a listen() still waiting to start gives up. */
let listenTicket = 0;

const running = () => started > ended;
const runningSession = () => sessions.get(ended + 1);

function getRec(): Rec | null {
  if (rec) return rec;
  const Ctor = recCtor();
  if (!Ctor) return null;
  rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  rec.onresult = (e) => {
    const first = e.results[0];
    const alts: string[] = [];
    if (first) for (let i = 0; i < first.length; i++) alts.push(first[i]?.transcript ?? "");
    runningSession()?.onResult(alts);
  };
  rec.onerror = (e) => runningSession()?.onError(e.error);
  rec.onend = () => {
    const sess = runningSession();
    if (started > ended) ended++;
    if (sess) {
      sessions.delete(sess.idx);
      sess.onEnd();
    }
    const w = endWaiters;
    endWaiters = [];
    w.forEach((f) => f());
  };
  return rec;
}

/** Resolves once no recognition is running: waits for onend, or aborts and waits up to 250 ms. */
function waitEnded(): Promise<void> {
  if (!running()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const f = () => {
      if (done) return;
      done = true;
      resolve();
    };
    endWaiters.push(f);
    try {
      rec?.abort();
    } catch {
      /* already stopped */
    }
    setTimeout(f, END_WAIT_MS);
  });
}

export function stopListening(): void {
  listenTicket++;
  const c = current;
  current = null;
  if (c) {
    c.settle({ status: "aborted" });
    vlog("listen-stopped");
  }
  if (running()) {
    try {
      rec?.abort();
    } catch {
      /* already stopped */
    }
  }
}

/** Listens once for up to timeoutMs on the shared recognizer. Urdu uses ur-PK, otherwise en-US. */
export async function listen(lang: Lang, timeoutMs = 6000): Promise<ListenResult> {
  stopListening();
  const ticket = listenTicket;
  const screen = activeScreen;
  const r = getRec();
  if (!r) return { status: "unavailable" };
  const stale = () => ticket !== listenTicket || screen !== activeScreen;

  // Never listen while speaking: a stuck utterance (safety timer fired) is cancelled.
  const s = synth();
  if (s?.speaking) {
    vlog("cancel-stuck-speech");
    cancelSpeech();
    lastSpeechEnd = Date.now();
  }
  await waitEnded();
  const gap = lastSpeechEnd + AFTER_SPEECH_MS - Date.now();
  if (gap > 0) await sleep(gap);
  if (stale()) return { status: "aborted" };

  r.lang = lang === "ur" ? "ur-PK" : "en-US";
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 3;
  for (let attempt = 0; ; attempt++) {
    try {
      r.start();
      break;
    } catch (err) {
      const name = err instanceof Error ? err.name : String(err);
      vlog("start-failed", { error: name, attempt });
      if (name !== "InvalidStateError" || attempt >= START_RETRIES) {
        setStatus({ s: "error", code: name });
        return { status: "nomatch", code: name };
      }
      try {
        r.abort();
      } catch {
        /* ignore */
      }
      await sleep(START_RETRY_MS);
      if (stale()) return { status: "aborted" };
    }
  }
  const idx = ++started;
  setStatus({ s: "listening" });
  vlog("listening", { lang: r.lang, session: idx });

  return new Promise<ListenResult>((resolve) => {
    let settled = false;
    let gotResult = false;
    const settle = (res: ListenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (current === sess) current = null;
      resolve(res);
    };
    const sess: Session = {
      idx,
      settle,
      onResult: (alts) => {
        gotResult = true;
        if (screen !== activeScreen) { vlog("stale-result-ignored", { session: idx }); settle({ status: "aborted" }); return; }
        vlog("result", { alternatives: privateResults ? "[hidden]" : alts });
        settle({ status: "ok", text: alts[0] ?? "", alternatives: alts });
      },
      onError: (code) => {
        if (settled) return;
        vlog("error", { error: code, session: idx });
        setStatus({ s: "error", code });
        if (code === "not-allowed" || code === "service-not-allowed") settle({ status: "blocked", code });
        else settle({ status: "nomatch", code });
      },
      onEnd: () => {
        if (settled) return;
        if (!gotResult) {
          vlog("ended-without-result", { session: idx });
          setStatus({ s: "error", code: "no-speech" });
        }
        settle({ status: "nomatch", code: "no-speech" });
      },
    };
    sessions.set(idx, sess);
    current = sess;
    const timer = setTimeout(() => {
      if (settled) return;
      vlog("timeout", { session: idx });
      setStatus({ s: "error", code: "no-speech" });
      settle({ status: "nomatch", code: "no-speech" });
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
  });
}
