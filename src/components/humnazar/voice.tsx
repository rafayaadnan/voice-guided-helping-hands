import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from "react";

import { MIC_LINE } from "@/lib/humnazar/i18n";
import { LISTEN_MS, MASKED_CNIC } from "@/lib/humnazar/logic";
import { getMic, getMicServer, isPrivateListening, listen, reportHeard, stopListening, subscribeMic } from "@/lib/humnazar/speech";
import { parseBack, parseCmd, parseConfirm, type CmdWord } from "@/lib/humnazar/voice-words";
import { useP, type AskOpts, type Say, type ScreenVoice } from "./context";
import { Icon } from "./ui";

/* ---------- Voice-confirm button ---------- */

/** First choice (tap or voice) speaks what it does and listens for "confirm"; a second tap is a silent fallback. */
export function ConfirmBtn({ id, msg, onConfirm, cls = "hz-bt hz-p", disabled, busy, children, label }: {
  id: string; msg: Say; onConfirm: () => void; cls?: string; disabled?: boolean | undefined; busy?: boolean | undefined; children: ReactNode; label?: string | undefined;
}) {
  const { press, armed, armListening } = useP();
  const on = armed === id;
  return (
    <div className="hz-cf">
      <button
        type="button"
        className={`${cls}${busy ? " is-busy" : ""}`}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        aria-label={label}
        aria-describedby={on ? `hz-hint-${id}` : undefined}
        onClick={() => press(id, msg, onConfirm)}
      >
        {children}
      </button>
      {on && <ArmHint id={id} listening={armListening} />}
    </div>
  );
}

/** Status line for sighted evaluators while a choice waits for "confirm" or "cancel". */
export function ArmHint({ id, listening }: { id: string; listening: boolean }) {
  const { t } = useP();
  return (
    <div id={`hz-hint-${id}`} className="hz-armhint hz-fade-in" role="status">
      <Icon n="mc" />
      <span>{listening ? `${t.listening} ${t.sayConfirm}` : t.sayConfirm}</span>
    </div>
  );
}

/* ---------- Screen question: speak caption + question, then listen ---------- */

/** While the CNIC is being heard, the heard-text line shows the fixed mask instead of the words. */
const shownHeard = (text: string) => (isPrivateListening() ? MASKED_CNIC : text);

/** Returns the screen's ask(); Frame runs it when the screen opens and registers it for repeat and cancel. */
export function useScreenAsk(voice: ScreenVoice | undefined, spoken: Say) {
  const { say, langRef, voiceRef, markVoiceOff, hear, begin, isCurrent, clearArm, setMic, voiceBack } = useP();
  const vRef = useRef(voice);
  vRef.current = voice;
  const spokenRef = useRef(spoken);
  spokenRef.current = spoken;
  const backRef = useRef(voiceBack);
  backRef.current = voiceBack;

  const ask = useCallback(async (o: AskOpts = {}): Promise<void> => {
    const token = begin();
    clearArm();
    stopListening();
    setMic({ s: "idle" });
    const mode = o.mode ?? "full";
    let ok = true;
    if (o.pre) ok = await say(o.pre);
    if (!ok || !isCurrent(token)) return;
    if (mode !== "listen") {
      const v = vRef.current;
      if (v?.prompt) ok = await v.prompt();
      else {
        // Screens that listen end their prompt with "Say back to go back." (not Home or Ask Later sent).
        const hint = !!v && (!!v.parse || !!v.cmds) && !v.noBackHint;
        ok = await say((x, l) => [mode === "full" ? spokenRef.current(x, l) : "", v?.q ? v.q(x, l) : "", hint ? x.backHint : ""].filter(Boolean).join(" "));
      }
      if (!ok || !isCurrent(token)) return;
    }
    if (!vRef.current || (!vRef.current.parse && !vRef.current.cmds)) return;
    if (voiceRef.current === "off") { await markVoiceOff(); return; }
    type Hit = { run: () => void } | "repeat" | "back";
    const v0 = vRef.current;
    const r = await hear<Hit>(token, {
      lang: (attempt) => vRef.current?.listenLang?.(attempt) ?? langRef.current,
      match: (alt) => {
        const v = vRef.current;
        if (!v) return null;
        const hit = v.parse?.(alt) ?? null;
        const key = hit ? null : parseCmd(alt, Object.keys(v.cmds ?? {}) as CmdWord[]);
        const run = hit ?? (key ? v.cmds?.[key] : undefined);
        if (run) return { run };
        // "back", "cancel", "واپس" or "منسوخ" go to the previous screen (Home ignores "cancel").
        const b = parseBack(alt);
        if (b === "back" || (b === "cancel" && !v.ignoreCancel)) return "back";
        return parseConfirm(alt) === "repeat" ? "repeat" : null;
      },
      retry: () => {
        const v = vRef.current;
        return v?.retry ? v.retry() : say((x, l) => `${x.notHeardQ} ${v?.q ? v.q(x, l) : ""}`.trim());
      },
      heardRetry: v0?.options ? (heard) => say((x, l) => x.heardSay(heard, vRef.current?.options?.(x, l) ?? "")) : undefined,
      quiet: v0?.quiet,
      onListen: (on) => { if (on) setMic({ s: "listening" }); },
      onMiss: (heard) => setMic(heard ? { s: "heard", heard: shownHeard(heard) } : { s: "idle" }),
    });
    if (r.s === "stop") { if (isCurrent(token)) setMic({ s: "idle" }); return; }
    if (r.s === "hit") {
      if (r.hit === "repeat") { void ask({ mode: "full" }); return; }
      if (r.hit === "back") { backRef.current(); return; }
      setMic({ s: "heard", heard: shownHeard(r.text) });
      r.hit.run();
      return;
    }
    setMic({ s: "failed" });
  }, [say, langRef, voiceRef, markVoiceOff, hear, begin, isCurrent, clearArm, setMic]);
  return ask;
}

/** Status line under the caption strip: Listening… / Heard … / Tap the screen to try again. */
export function MicLine() {
  const { t, mic, armed } = useP();
  if (armed || mic.s === "idle") return null;
  if (mic.s === "listening") return <div className="hz-vs hz-mic" role="status"><Icon n="mc" />{t.listening}</div>;
  if (mic.s === "heard") return <div className="hz-vs hz-mic" role="status"><Icon n="ck" />{t.heard(mic.heard ?? "")}</div>;
  return <div className="hz-vs hz-mic fail" role="status"><Icon n="al" />{t.tapScreen}</div>;
}

/** Evaluator line at the bottom of every blind-user screen: Mic: speaking / listening / heard '…' / no match / error <code>. */
export function MicStatusLine() {
  const { t, blocked } = useP();
  const m = useSyncExternalStore(subscribeMic, getMic, getMicServer);
  const text = m.s === "heard" ? MIC_LINE.heard(m.text) : m.s === "error" ? MIC_LINE.error(m.code) : MIC_LINE[m.s];
  return (
    <>
      {blocked && <div className="hz-vs hz-mic fail" role="alert"><Icon n="al" />{t.micBlocked}</div>}
      <div className="hz-micst" dir="ltr" lang="en" data-mic-status={m.s}>{text}</div>
    </>
  );
}

/* ---------- Ask by voice ---------- */

type Status = "idle" | "listening" | "heard" | "failed";
type AskOutcome = "ok" | "fail" | "off" | "cancel";

/** Speaks a question (optional), listens up to 6 s, retries once with "Sorry…", then asks to tap again. */
export function useVoiceAsk<T>(parse: (text: string) => T | null, onValue: (v: T) => void) {
  const { say, langRef, voiceRef, markVoiceOff, markBlocked, markVoiceOk, begin, clearArm, setMic } = useP();
  const [status, setStatus] = useState<Status>("idle");
  const [heard, setHeard] = useState("");
  const alive = useRef(true);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const ask = async (question?: Say): Promise<AskOutcome> => {
    begin();
    clearArm();
    setMic({ s: "idle" });
    stopListening();
    if (question) {
      const ok = await say(question);
      if (!ok || !alive.current) return "cancel";
    }
    if (voiceRef.current === "off") { await markVoiceOff(); return "off"; }
    for (let attempt = 0; attempt < 2; attempt++) {
      setStatus("listening");
      const r = await listen(langRef.current, 6000);
      if (!alive.current) return "cancel";
      if (r.status === "aborted") { setStatus("idle"); return "cancel"; }
      if (r.status === "blocked") { setStatus("idle"); await markBlocked(); return "off"; }
      if (r.status === "unavailable") { setStatus("idle"); await markVoiceOff(); return "off"; }
      if (r.status === "ok") {
        markVoiceOk();
        setHeard(r.text);
        const hit = r.alternatives.map(parse).find((v) => v !== null && v !== undefined);
        reportHeard(r.text, hit !== undefined && hit !== null);
        if (hit !== undefined && hit !== null) {
          setStatus("heard");
          onValueRef.current(hit);
          return "ok";
        }
      }
      if (attempt === 0) {
        setStatus("idle");
        const ok = await say((t) => t.sorry);
        if (!ok || !alive.current) return "cancel";
      }
    }
    setStatus("failed");
    void say((t) => t.tapRetry);
    return "fail";
  };
  return { status, heard, ask };
}

function VoiceStatus({ status, heard }: { status: Status; heard: string }) {
  const { t } = useP();
  if (status === "idle") return null;
  if (status === "listening") return <span className="hz-vs" role="status"><Icon n="mc" />{t.listening}</span>;
  if (status === "heard") return <span className="hz-vs" role="status"><Icon n="ck" />{t.heard(heard)}</span>;
  return <span className="hz-vs fail" role="status"><Icon n="al" />{heard ? `${t.heard(heard)} · ` : ""}{t.tapRetry}</span>;
}

/** Full-width 88px row: label on line 1, current value on line 2. Tapping asks the question aloud and listens. */
export function VoiceRow<T>({ label, value, question, parse, onValue, choices, askRef }: {
  label: string; value: string; question: Say; parse: (text: string) => T | null; onValue: (v: T) => void;
  choices: { label: string; value: T }[]; askRef?: MutableRefObject<(() => void) | null>;
}) {
  const { t, voice } = useP();
  const [fallback, setFallback] = useState(false);
  const { status, heard, ask } = useVoiceAsk(parse, onValue);
  const tap = async () => {
    setFallback(false);
    const r = await ask(question);
    if (r === "off") setFallback(true);
  };
  if (askRef) askRef.current = () => void tap();
  return (
    <>
      <button type="button" className={`hz-row${status === "listening" ? " is-listening" : ""}`} onClick={tap} aria-label={`${label}: ${value}. ${t.tapToSpeak}`}>
        <span className="tx">
          <span className="l">{label}</span>
          <span className="v">{value}</span>
          <VoiceStatus status={status} heard={heard} />
        </span>
        <span className="ic" aria-hidden="true"><Icon n="mc" s={28} /></span>
      </button>
      {fallback && voice === "off" && (
        <div className="hz-fb hz-fade-in">
          <b>{t.fallbackLabel}</b>
          <p className="hz-note">{t.voiceOff}</p>
          {choices.map((c) => (
            <button key={c.label} type="button" className="hz-bt hz-pr" onClick={() => { setFallback(false); onValue(c.value); }}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** "Say your choice" row on screens whose choices are big buttons; shows the screen's listening status, tap to ask again. */
export function ListenRow() {
  const { t, voice, mic, armed, reask } = useP();
  // Choices are already big buttons; the one-time "voice is off" message is spoken by markVoiceOff.
  if (voice === "off") return null;
  const listening = mic.s === "listening" && !armed;
  return (
    <button type="button" className={`hz-row${listening ? " is-listening" : ""}`} onClick={() => reask({ mode: "question" })} aria-label={`${t.sayChoice}. ${t.tapToSpeak}`}>
      <span className="tx">
        <span className="l">{t.sayChoice}</span>
        {listening ? <span className="hz-vs" role="status"><Icon n="mc" />{t.listening}</span>
          : mic.s === "heard" && !armed ? <span className="hz-vs" role="status"><Icon n="ck" />{t.heard(mic.heard ?? "")}</span>
          : mic.s === "failed" && !armed ? <span className="hz-vs fail" role="status"><Icon n="al" />{t.tapScreen}</span>
          : <span className="hz-vs"><Icon n="mc" />{t.tapToSpeak}</span>}
      </span>
      <span className="ic" aria-hidden="true"><Icon n="mc" s={28} /></span>
    </button>
  );
}
