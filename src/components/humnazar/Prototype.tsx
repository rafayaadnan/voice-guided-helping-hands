import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import spiceImg from "@/assets/sample-spice-packet.jpg";
import medicineImg from "@/assets/sample-medicine-strip.jpg";
import shirtImg from "@/assets/sample-shirts.jpg";
import billImg from "@/assets/sample-gas-bill.jpg";
import { LANG_SCREEN, START_VOICE, STRINGS, type Strings } from "@/lib/humnazar/i18n";
import {
  acceptAtSecondsLeft,
  acceptingVolunteer,
  afterLanguage,
  afterLanguageFor,
  afterStart,
  ASK_LATER_REPLIER,
  canWiden,
  demoTickMs,
  formatSeconds,
  LISTEN_MS,
  makeRequestNumber,
  MASKED_CNIC,
  matchingVolunteers,
  needsHuman,
  SAMPLE_ITEM_KIND,
  SETUP_STEPS,
  USER_FIRST_NAME,
  volunteer,
  WAIT_SECONDS,
  type Gender,
  type Helper,
  type Lang,
  type SampleItemId,
} from "@/lib/humnazar/logic";
import { cancelSpeech, closeScreen, hasUrduVoice, listen, openScreen, recognitionSupported, reportHeard, setPrivateListening, speak, stopListening } from "@/lib/humnazar/speech";
import { parseAccept, parseCallEnded, parseConfirm, parseEndCall, parseFreeAnswer, parseGender, parseHelper, parseHelperCmd, parseHelpType, parseNeedHelp, parseStartCall, parseLanguage, parsePhoto, parseRating, parseShowHide, parseStartRole, parseYesNo, spellRequestNumber, type HelpTypeWord } from "@/lib/humnazar/voice-words";
import {
  PrototypeContext, useP,
  type Anim, type AskOpts, type Ctx, type HearOpts, type HearResult, type Mic, type Mode, type Request, type Say, type ScreenId, type ScreenVoice, type Session, type VoiceState,
} from "./context";
import { ArmHint, ConfirmBtn, ListenRow, MicLine, MicStatusLine, useScreenAsk, VoiceRow } from "./voice";
import { Btn, Camera, Chip, Icon, Notice, StatusCard, Tip, Toggle } from "./ui";

const IMG: Record<SampleItemId, string> = { spice: spiceImg, medicine: medicineImg, shirt: shirtImg, bill: billImg };
const VOLUNTEER_SCREENS: ScreenId[] = ["WEL", "A", "VS", "VL", "V1", "V2x", "V3", "V5", "VM", "VT"];
const HOME: ScreenId[] = ["A", "L", "B"];

const freshRequest = (): Request => ({ number: null, photo: null, widened: false, volunteerId: null });

const initialSession: Session = {
  signup: false,
  role: "user",
  lang: "en",
  helper: "friend",
  lastMode: null,
  friends: ["bilal", "usman"],
  unavailable: [],
  linkUsed: false,
  request: freshRequest(),
  askLater: { photo: null, carried: false },
  askLaterNumber: null,
};

/* ---------- Frame ---------- */

function Frame({ title, caption, cap, spoken, voice, strip, hideMic, hideCap, children, actions, noBack }: {
  title: string; caption?: string; cap?: Say; spoken?: Say; voice?: ScreenVoice; strip?: ReactNode; hideMic?: boolean; hideCap?: boolean;
  children?: ReactNode; actions?: ReactNode; noBack?: boolean;
}) {
  const { t, lang, back, blind, s, registerScreen, tapRepeat } = useP();
  const text = cap ? cap(t, lang) : (caption ?? "");
  // The "Reads aloud:" box is hidden from view on Start (hideCap), blind-user screens and volunteer screens;
  // blind-user captions are still spoken.
  const capHidden = hideCap || blind || s.role === "volunteer";
  // Volunteers never get voice input: their copy of Choose language does not speak, listen or show mic lines.
  const voiceOn = blind && s.role !== "volunteer";
  const speech = spoken ?? cap ?? (() => text);
  const ask = useScreenAsk(voice, speech);

  // Every blind-user screen gets a new voice-controller id when it opens (older results are ignored),
  // speaks its caption and question, then listens. Closing the screen stops its speech and listening.
  useEffect(() => {
    if (!voiceOn) return;
    const id = openScreen();
    registerScreen(ask);
    void ask({ mode: "full" });
    return () => { closeScreen(id); registerScreen(null); };
  }, [voiceOn, ask, registerScreen]);

  const content = strip ?? (
    <>
      <Icon n="sp" s={20} />
      <span><b>{t.readsAloud}</b> {text}</span>
    </>
  );
  return (
    <>
      <div className={`hz-tb${noBack ? "" : " has-back"}`}>
        {!noBack && (
          <button type="button" className="hz-back" onClick={back} aria-label={t.back}>
            <Icon n="bk" s={28} />
          </button>
        )}
        <h1 tabIndex={-1} data-screen-title dir={blind ? (lang === "ur" ? "rtl" : "ltr") : undefined}>{title}</h1>
      </div>
      {blind ? (
        <>
          <button type="button" className={`hz-cs${capHidden ? " hz-hide" : ""}`} role="status" aria-live="polite" dir={lang === "ur" ? "rtl" : "ltr"} onClick={tapRepeat}>
            {content}
          </button>
          {!hideMic && voiceOn && <MicLine />}
        </>
      ) : (
        <div className={`hz-cs${capHidden ? " hz-hide" : ""}`} role="status" aria-live="polite">{content}</div>
      )}
      <div className="hz-ct">{children}</div>
      {actions && <div className="hz-ac">{actions}</div>}
      {voiceOn && <MicStatusLine />}
    </>
  );
}

function NotForEmergencies() {
  const { t } = useP();
  return <Notice v="n" icon="al" title={t.notEmergTitle}>{t.notEmergBody}</Notice>;
}

const vName = (id: string | null, lang: Lang) => (id ? volunteer(id).name[lang] : "");

/* ---------- Start: tap anywhere starts the voice (browsers block speech until a tap) ---------- */

/** Listening rounds per tap (each round: en-US, then ur-PK); then the user taps again. */
const START_ROUNDS = 3;

function StartScreen() {
  const { t, s, go, set, say, begin, isCurrent, registerScreen, voiceRef, markVoiceOff, markBlocked, markVoiceOk } = useP();
  const signup = s.signup;
  const choose = useCallback((role: "user" | "volunteer") => { set((x) => ({ ...x, role })); go(afterStart(signup, role)); }, [set, go, signup]);

  const ask = useCallback(async (): Promise<void> => {
    const token = begin();
    stopListening();
    const en = (text: string) => say(() => text, "en");
    let ok = await en(START_VOICE.prompt.en);
    if (!ok || !isCurrent(token)) return;
    if (hasUrduVoice()) {
      ok = await say(() => START_VOICE.prompt.ur, "ur");
      if (!ok || !isCurrent(token)) return;
    }
    for (let round = 0; round < START_ROUNDS; round++) {
      if (voiceRef.current === "off") { await markVoiceOff(); return; }
      let heard = "";
      // Listen in English first; when nothing matches, listen once more in Urdu.
      for (const lang of ["en", "ur"] as const) {
        const r = await listen(lang, LISTEN_MS);
        if (!isCurrent(token) || r.status === "aborted") return;
        if (r.status === "blocked") { await markBlocked(); return; }
        if (r.status === "unavailable") { await markVoiceOff(); return; }
        if (r.status !== "ok") continue;
        markVoiceOk();
        for (const alt of r.alternatives) {
          const role = parseStartRole(alt);
          if (!role) continue;
          reportHeard(alt, true);
          await en(START_VOICE.selected(role));
          if (isCurrent(token)) choose(role);
          return;
        }
        heard = r.text.trim() || heard;
        reportHeard(r.text, false, true);
      }
      const last = round === START_ROUNDS - 1;
      ok = await en(last ? START_VOICE.tapHint : heard ? START_VOICE.heardSay(heard) : START_VOICE.notHeard);
      if (!ok || !isCurrent(token) || last) return;
    }
  }, [begin, say, isCurrent, voiceRef, markVoiceOff, markBlocked, markVoiceOk, choose]);

  // Nothing speaks on open; the shell's tap-anywhere handler calls ask() through registerScreen.
  useEffect(() => {
    const id = openScreen();
    registerScreen(() => ask());
    return () => { closeScreen(id); registerScreen(null); };
  }, [ask, registerScreen]);

  return (
    <Frame noBack hideCap title={signup ? t.A_signupTitle : t.A_title}
      strip={<>
        <Icon n="sp" s={20} />
        <span dir="ltr" lang="en"><b>{START_VOICE.readsAloud}</b> {START_VOICE.prompt.en}</span>
      </>}
      actions={<>
        <Btn onClick={() => choose("user")}>{t.A_user}</Btn>
        <Btn kind="s" onClick={() => choose("volunteer")}>{t.A_vol}</Btn>
        <p className="hz-note hz-taphint" dir="ltr" lang="en">{START_VOICE.tapHint}</p>
        <MicStatusLine />
      </>}>
      <Notice v="i" icon="in">{t.A_info}</Notice>
    </Frame>
  );
}

/* ---------- Choose language (both roles, bilingual) ---------- */

function ChooseLanguage() {
  const { s, go, say, press, setLang, armed, armListening } = useP();
  /** Speaks the English line, then the Urdu line when an Urdu voice is installed. */
  const blindUser = s.role !== "volunteer";
  const both = async (k: "prompt" | "retry") => {
    // Blind users hear "Say back to go back." at the end of the prompt, in each language.
    const hint = (l: Lang) => (k === "prompt" && blindUser ? ` ${STRINGS[l].backHint}` : "");
    // In sign-up the prompt starts with "Step 1 of 5", in each language.
    const step = (l: Lang) => (k === "prompt" && s.signup ? `${STRINGS[l].setupStep(1, SETUP_STEPS)}${l === "ur" ? "۔" : "."} ` : "");
    const ok = await say(() => step("en") + LANG_SCREEN[k].en + hint("en"), "en");
    if (!ok || !hasUrduVoice()) return ok;
    return say(() => step("ur") + LANG_SCREEN[k].ur + hint("ur"), "ur");
  };
  const choose = (l: Lang) => {
    setLang(l);
    // Volunteers choose by tap only: no spoken confirm step.
    if (!blindUser) { go(afterLanguage(s.role)); return; }
    press(`lang-${l}`, (x) => x.L_selected(l), () => go(afterLanguageFor(s.role, s.signup)), l);
  };
  const voice: ScreenVoice = {
    prompt: () => both("prompt"),
    retry: () => both("retry"),
    parse: (x) => { const l = parseLanguage(x); return l ? () => choose(l) : null; },
    // Language is unknown here: the first try listens in Urdu, the second in English.
    listenLang: (attempt) => (attempt === 0 ? "ur" : "en"),
    ignoreCancel: !blindUser,
  };
  const opt = (l: Lang, label: string) => (
    <div className="hz-cf">
      <button type="button" className="hz-bt hz-s hz-lang" lang={l} dir={l === "ur" ? "rtl" : "ltr"}
        aria-describedby={armed === `lang-${l}` ? `hz-hint-lang-${l}` : undefined} onClick={() => choose(l)}>
        {label}
      </button>
      {armed === `lang-${l}` && <ArmHint id={`lang-${l}`} listening={armListening} />}
    </div>
  );
  return (
    <Frame title={LANG_SCREEN.title.en} caption={LANG_SCREEN.prompt.en} voice={voice}
      strip={<>
        <Icon n="sp" s={20} />
        <span className="hz-bi">
          <span dir="ltr" lang="en"><b>{LANG_SCREEN.readsAloud.en}</b> {LANG_SCREEN.prompt.en}</span>
          <span dir="rtl" lang="ur"><b>{LANG_SCREEN.readsAloud.ur}</b> {LANG_SCREEN.prompt.ur}</span>
        </span>
      </>}>
      {s.signup && (
        <div className="hz-bi hz-step">
          <span dir="ltr" lang="en">{STRINGS.en.setupStep(1, SETUP_STEPS)}</span>
          <span dir="rtl" lang="ur">{STRINGS.ur.setupStep(1, SETUP_STEPS)}</span>
        </div>
      )}
      {opt("ur", LANG_SCREEN.urdu)}
      {opt("en", LANG_SCREEN.english)}
    </Frame>
  );
}

/* ---------- Blind or low-vision user (voice-first) ---------- */

function Home() {
  const { t, go, set, press } = useP();
  const needHelp = () => { set((s) => ({ ...s, request: freshRequest() })); go("D"); };
  return (
    <Frame title={t.B_title} cap={(x) => x.B_cap}
      voice={{ q: (x) => x.B_q, options: (x) => x.B_opts, ignoreCancel: true, noBackHint: true, parse: (x) => (parseNeedHelp(x) ? () => press("needHelp", (y) => y.cf.needHelp, needHelp) : null) }}>
      <NotForEmergencies />
      <div className="hz-gr">
        <ConfirmBtn id="needHelp" msg={(x) => x.cf.needHelp} onConfirm={needHelp}>{t.B_help}</ConfirmBtn>
      </div>
    </Frame>
  );
}

function ChooseHelpType() {
  const { t, go, s, set, press } = useP();
  const target: Record<HelpTypeWord, ScreenId> = { quick: "QP", call: "G", later: "Y" };
  const icons: Record<HelpTypeWord, "ey" | "ph" | "cl"> = { quick: "ey", call: "ph", later: "cl" };
  const labels: Record<HelpTypeWord, string> = { quick: t.D_quick, call: t.D_call, later: t.D_later };
  const run = (m: HelpTypeWord) => {
    set((x) => ({
      ...x,
      lastMode: m as Mode,
      askLater: m === "later" ? { photo: x.request.photo, carried: false } : x.askLater,
    }));
    go(target[m]);
  };
  return (
    <Frame title={t.D_title} cap={(x) => x.D_cap} hideMic
      voice={{ q: (x) => x.D_q, parse: (x) => { const m = parseHelpType(x); return m ? () => press(`ht-${m}`, (y) => y.cf[m], () => run(m)) : null; } }}>
      <NotForEmergencies />
      <p>{t.D_p}</p>
      <ListenRow />
      {(["quick", "call", "later"] as const).map((m) => (
        <ConfirmBtn key={m} id={`ht-${m}`} cls={`hz-bt hz-ht${s.lastMode === m ? " hz-pd" : ""}`} msg={(x) => x.cf[m]} onConfirm={() => run(m)}>
          <span className="ic"><Icon n={icons[m]} s={28} /></span>
          <span>
            {labels[m]}
            <span className="desc">{t.D_desc[m]}</span>
            {s.lastMode === m && <span className="last"><Icon n="ck" s={20} />{t.D_last}</span>}
          </span>
        </ConfirmBtn>
      ))}
    </Frame>
  );
}

function QuickLookPhoto() {
  const { t, go, set, press, reask } = useP();
  const [taken, setTaken] = useState(false);
  const choose = (id: SampleItemId) => {
    set((s) => ({ ...s, request: { ...s.request, photo: id } }));
    go(needsHuman(SAMPLE_ITEM_KIND[id]) ? "F" : "Q");
  };
  const take = () => setTaken(true);
  useEffect(() => {
    if (taken) reask({ mode: "full" });
  }, [taken, reask]);
  if (!taken) {
    return (
      <Frame title={t.QP_title} cap={(x) => x.QP_cap}
        voice={{ q: (x) => x.QP_qTake, cmds: { takePhoto: () => press("takePhoto", (x) => x.cf.takePhoto, take) } }}
        actions={<ConfirmBtn id="takePhoto" msg={(x) => x.cf.takePhoto} onConfirm={take}>{t.QP_take}</ConfirmBtn>}>
        <Camera tall>{t.cameraPlaceholder}</Camera>
      </Frame>
    );
  }
  return (
    <Frame title={t.QP_title} cap={(x) => x.QP_cap2} hideMic
      voice={{
        q: (x) => x.QP_q,
        options: (x) => x.QP_opts,
        parse: (x) => {
          const id = parsePhoto(x);
          if (!id) return null;
          return () => {
            // Pick the photo right away, then speak it and ask for confirm or cancel.
            set((s) => ({ ...s, request: { ...s.request, photo: id } }));
            press(`photo-${id}`, (y) => y.cf.photo(y.itemShort[id]), () => choose(id));
          };
        },
      }}>
      <ListenRow />
      <p className="hz-lbl">{t.QP_pick}</p>
      {(["spice", "medicine", "shirt"] as const).map((id) => (
        <ConfirmBtn key={id} id={`photo-${id}`} cls="hz-bt hz-pr hz-pick" msg={(x) => x.cf.photo(x.itemShort[id])} onConfirm={() => choose(id)}>
          <img src={IMG[id]} alt="" width={64} height={64} />
          <span>{t.item[id]}</span>
        </ConfirmBtn>
      ))}
    </Frame>
  );
}

function HumanNeeded() {
  const { t, go, set, press } = useP();
  const call = () => go("G");
  const later = () => { set((s) => ({ ...s, askLater: { photo: s.request.photo, carried: true } })); go("Y"); };
  return (
    <Frame title={t.F_title} cap={(x) => x.F_cap}
      voice={{ q: (x) => x.F_q, cmds: { later: () => press("f-later", (x) => x.cf.later, later), call: () => press("f-call", (x) => x.cf.call, call) } }}
      actions={<ConfirmBtn id="f-call" msg={(x) => x.cf.call} onConfirm={call}>{t.D_call}</ConfirmBtn>}>
      <p>{t.F_p}</p>
      <ConfirmBtn id="f-later" cls="hz-bt hz-s" msg={(x) => x.cf.later} onConfirm={later}>{t.D_later}</ConfirmBtn>
    </Frame>
  );
}

function QuickLookAnswer() {
  const { t, go, press } = useP();
  const notSure = () => go("G");
  const done = () => go("B", { reset: HOME, anim: "back" });
  return (
    <Frame title={t.Q_title} cap={(x) => `${x.Q_badge}: ${x.Q_answer}`}
      voice={{ q: (x) => x.Q_q, cmds: { notSure: () => press("q-notsure", (x) => x.cf.notSure, notSure), done: () => press("q-done", (x) => x.cf.doneHome, done) } }}
      actions={<ConfirmBtn id="q-notsure" msg={(x) => x.cf.notSure} onConfirm={notSure}>{t.Q_notSure}</ConfirmBtn>}>
      <span className="hz-ai"><Icon n="in" s={20} />{t.Q_badge}</span>
      <div className="hz-card">{t.Q_samplePrefix} {t.Q_answer}</div>
      <ConfirmBtn id="q-done" cls="hz-bt hz-s" msg={(x) => x.cf.doneHome} onConfirm={done}>{t.done}</ConfirmBtn>
    </Frame>
  );
}

function ChooseHelper() {
  const { t, go, s, set, press, reask } = useP();
  const selected = s.helper && !s.unavailable.includes(s.helper) ? s.helper : null;
  const helpers: Helper[] = ["friend", "woman", "man", "anyone"];
  const pickHelper = (h: Helper) => {
    if (s.unavailable.includes(h)) { reask({ mode: "listen", pre: (x) => `${x.G_notFree(h)} ${x.G_qHelper}` }); return; }
    // Update the Helper row right away, say "Helper: …", then ask for confirm or cancel.
    set((x) => ({ ...x, helper: h }));
    press("g-continue", (x) => `${x.G_echoHelper(x.helper[h])} ${x.sayConfirm}`, next);
  };
  const next = () => go("T");
  return (
    <Frame title={t.G_title} cap={(x) => x.G_cap}
      voice={{
        q: (x) => (selected ? `${x.G_echoHelper(x.helper[selected])} ${x.G_qNext}` : x.G_qHelper),
        options: (x) => x.G_opts,
        parse: (x) => {
          const h = parseHelperCmd(x);
          if (!h) return null;
          if (h !== "continue") return () => pickHelper(h);
          return () => (selected ? press("g-continue", (y) => y.cf.continue, next) : reask({ mode: "listen", pre: (y) => `${y.G_pickFree} ${y.G_qHelper}` }));
        },
      }}
      actions={<ConfirmBtn id="g-continue" msg={(x) => x.cf.continue} onConfirm={next} disabled={!selected}>{t.G_continue}</ConfirmBtn>}>
      <VoiceRow label={t.G_helper} value={selected ? t.helper[selected] : t.notChosen} question={(x) => x.G_qHelper}
        parse={parseHelper} onValue={pickHelper}
        choices={helpers.map((h) => ({ label: s.unavailable.includes(h) ? `${t.helper[h]} · ${t.G_noneFree}` : t.helper[h], value: h }))} />
      {!selected && <p className="hz-note">{t.G_pickFree}</p>}
    </Frame>
  );
}

function BeforeCall() {
  const { t, go, set, press } = useP();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => {
      set((s) => ({ ...s, request: { ...s.request, number: s.request.number ?? makeRequestNumber(), widened: false, volunteerId: null } }));
      go("H", { anim: "fade" });
    }, 1000);
    return () => clearTimeout(id);
  }, [busy, go, set]);
  const start = () => setBusy(true);
  return (
    <Frame title={t.T_title} cap={(x) => (busy ? x.T_starting : x.T_cap)}
      voice={{ q: (x) => x.T_q, options: (x) => x.T_opts, parse: (x) => (parseStartCall(x) ? () => press("t-start", (y) => y.cf.startCall, start) : null) }}
      actions={<ConfirmBtn id="t-start" busy={busy} msg={(x) => x.cf.startCall} onConfirm={start}>
        {busy ? <><span className="hz-sp on-p" aria-hidden="true" />{t.T_starting}</> : t.T_start}
      </ConfirmBtn>}>
      <Tip icon="cm">{t.T_tip1}</Tip>
      <Tip icon="al">{t.T_tip2}</Tip>
    </Frame>
  );
}

function Waiting() {
  const { t, lang, go, s, set, say } = useP();
  const helper: Helper = s.request.widened ? "anyone" : (s.helper ?? "anyone");
  const accepter = acceptingVolunteer(helper);
  const [left, setLeft] = useState(WAIT_SECONDS);
  const [phase, setPhase] = useState<"wait" | "accepted" | "expired">("wait");

  useEffect(() => {
    if (phase !== "wait") return;
    const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), demoTickMs);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "wait") return;
    if (accepter && left <= acceptAtSecondsLeft) {
      setPhase("accepted");
      set((x) => ({ ...x, request: { ...x.request, volunteerId: accepter.id } }));
      void say((x, l) => x.H_accepted(accepter.name[l]));
    } else if (!accepter && left === 0) {
      setPhase("expired");
      set((x) => ({ ...x, unavailable: x.unavailable.includes(helper) ? x.unavailable : [...x.unavailable, helper] }));
    }
  }, [left, phase, accepter, helper, set, say]);

  useEffect(() => {
    if (phase === "wait") return;
    const id = setTimeout(() => go(phase === "accepted" ? "M" : "W", { replace: true, anim: "fade" }), phase === "accepted" ? 1600 : 800);
    return () => clearTimeout(id);
  }, [phase, go]);

  const ex = phase === "expired";
  return (
    <Frame title={t.H_title} cap={(x, l) => (phase === "accepted" && accepter ? x.H_accepted(accepter.name[l]) : ex ? x.W_cap : x.H_cap)} spoken={(x) => x.H_cap}>
      <div>
        <div className="hz-tm">
          {ex ? <Icon n="al" /> : <span className="hz-sp" aria-hidden="true" />}
          <b className={ex ? "ex" : ""} aria-hidden="true">{formatSeconds(left)}</b>
          <span>{ex ? t.H_up : t.H_left}</span>
        </div>
        <div className="hz-bar" aria-hidden="true"><i className={ex ? "ex" : ""} style={{ width: `${(left / WAIT_SECONDS) * 100}%` }} /></div>
      </div>
      <p>{t.H_p}</p>
      <div className="hz-vl">
        {matchingVolunteers(helper).map((v) => {
          const acc = phase === "accepted" && accepter?.id === v.id;
          const st = acc ? "accepted" : v.status === "free" ? "asking" : v.status;
          return (
            <div key={v.id} className={acc ? "acc" : ""}>
              <Icon n={acc ? "ck" : st === "asking" ? "cl" : "x"} s={20} />
              <span>{v.name[lang]}: {t.vs[st]} {t.sample}</span>
            </div>
          );
        })}
      </div>
      {phase === "accepted" && accepter && (
        <div className="hz-fade-in"><Notice v="ok" icon="ck" title={t.H_accepted(accepter.name[lang])} /></div>
      )}
      <StatusCard loading={!ex} label={t.status} status={t.stWaiting} numberLabel={t.requestNo} number={s.request.number ?? ""} sample={t.sample} />
    </Frame>
  );
}

function LiveCall() {
  const { t, lang, s, go, say, press, reask } = useP();
  const vid = s.request.volunteerId;
  const name = vName(vid, lang);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setStep(1), 3000);
    const b = setTimeout(() => setStep(2), 7500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  // Imran's (or Bilal's) live captions are spoken as they arrive; listening resumes after each one.
  useEffect(() => {
    if (step === 0) return;
    void say((x, l) => (step === 1 ? x.M_c1(vName(vid, l)) : x.M_c2(vName(vid, l)))).then((ok) => { if (ok) reask({ mode: "listen" }); });
  }, [step, say, vid, reask]);
  const end = () => go("R", { reset: [...HOME, "R"], anim: "fade" });
  const p = t.M_p(name);
  const cut = p.indexOf(" (");
  return (
    <Frame title={t.M_title} cap={(x, l) => (step === 0 ? x.M_cap(vName(vid, l)) : step === 1 ? x.M_c1(vName(vid, l)) : x.M_c2(vName(vid, l)))}
      spoken={(x, l) => x.M_cap(vName(vid, l))}
      voice={{ q: (x) => x.M_q, quiet: true, options: (x) => x.M_opts, parse: (x) => (parseEndCall(x) ? () => press("m-end", (y) => y.cf.endCall, end) : null) }}
      actions={<ConfirmBtn id="m-end" msg={(x) => x.cf.endCall} onConfirm={end}>{t.M_end}</ConfirmBtn>}>
      <Camera tall img={medicineImg} imgAlt={t.item.medicine} tag={t.cameraSample} />
      <p><b>{p.slice(0, cut)}</b>{p.slice(cut)}</p>
    </Frame>
  );
}

function CallEnded() {
  const { t, lang, s, set, go, press, reask } = useP();
  const vid = s.request.volunteerId;
  const name = vName(vid, lang);
  const isFriend = !!vid && s.friends.includes(vid);
  const [rating, setRating] = useState(0);
  const [reported, setReported] = useState(false);
  const [showNo, setShowNo] = useState(false);
  const rateAsk = useRef<(() => void) | null>(null);
  const friendAsk = useRef<(() => void) | null>(null);
  const numberAsk = useRef<(() => void) | null>(null);
  const yesNo = [{ label: t.yesWord, value: "yes" as const }, { label: t.noWord, value: "no" as const }];
  const next = (pre: Say) => reask({ mode: "listen", pre: (x, l) => `${pre(x, l)} ${x.R_q}` });
  const rate = (n: number) => { setRating(n); next((x) => x.R_echoRate(n)); };
  const setFriend = (yes: boolean) => {
    if (!vid) return;
    set((x) => ({ ...x, friends: yes ? (x.friends.includes(vid) ? x.friends : [...x.friends, vid]) : x.friends.filter((f) => f !== vid) }));
    next((x, l) => x.R_echoFriend(vName(vid, l), yes));
  };
  const setNumber = (yes: boolean) => { setShowNo(yes); next((x) => x.R_echoNumber(yes)); };
  const report = () => { setReported(true); next((x) => x.R_reported); };
  const done = () => go("CD", { reset: [...HOME, "CD"], anim: "fade" });
  return (
    <Frame title={t.R_title} cap={(x) => x.R_cap}
      voice={{
        q: (x) => x.R_q,
        options: (x) => x.R_opts,
        parse: (x) => {
          const c = parseCallEnded(x);
          if (!c) return null;
          if (c.k === "rate") return () => rate(c.n);
          if (c.k === "number") return () => setNumber(c.show);
          if (c.k === "friend") return () => setFriend(c.yes);
          if (c.k === "report") return () => (reported ? next((y) => y.R_reported) : press("r-report", (y) => y.cf.report, report));
          return () => press("r-done", (y) => y.cf.doneCall, done);
        },
        // Bare "rate", "friend" or "number" asks that row's question.
        cmds: {
          rate: () => rateAsk.current?.(),
          friend: () => friendAsk.current?.(),
          number: () => numberAsk.current?.(),
        },
      }}
      actions={<ConfirmBtn id="r-done" msg={(x) => x.cf.doneCall} onConfirm={done}>{t.done}</ConfirmBtn>}>
      <p>{t.R_p}</p>
      <VoiceRow label={t.R_rate} value={rating ? t.R_rateVal(rating) : t.R_rateNone} question={(x) => x.R_qRate}
        parse={parseRating} onValue={rate} askRef={rateAsk}
        choices={[1, 2, 3, 4, 5].map((n) => ({ label: t.R_rateVal(n), value: n }))} />
      <VoiceRow label={t.R_friendLabel(name)} value={isFriend ? t.yesWord : t.noWord} question={(x, l) => x.R_qFriend(vName(vid, l))}
        parse={parseYesNo} onValue={(v) => setFriend(v === "yes")} choices={yesNo} askRef={friendAsk} />
      <VoiceRow label={t.showNumber} value={showNo ? t.numberShownShort : t.numberHiddenShort} question={(x, l) => x.R_qNumber(vName(vid, l))}
        parse={parseYesNo} onValue={(v) => setNumber(v === "yes")} choices={yesNo} askRef={numberAsk} />
      {reported ? (
        <div className="hz-fade-in"><Notice v="ok" icon="ck" title={t.R_reported} /></div>
      ) : (
        <ConfirmBtn id="r-report" cls="hz-bt hz-s" msg={(x) => x.cf.report} onConfirm={report}>{t.R_report}</ConfirmBtn>
      )}
    </Frame>
  );
}

function RequestComplete() {
  const { t, s, go, press } = useP();
  const no = s.request.number ?? "";
  const home = () => go("B", { reset: HOME, anim: "back" });
  return (
    <Frame title={t.CD_title} cap={(x) => x.CD_cap(no)} spoken={(x) => x.CD_cap(spellRequestNumber(no))}
      voice={{ q: (x) => x.CD_q, cmds: { home: () => press("cd-home", (x) => x.cf.backHome, home) } }}
      actions={<ConfirmBtn id="cd-home" msg={(x) => x.cf.backHome} onConfirm={home}>{t.backHome}</ConfirmBtn>}>
      <StatusCard label={t.status} status={t.stCompleted} numberLabel={t.requestNo} number={no} sample={t.sample} />
    </Frame>
  );
}

function NoVolunteer() {
  const { t, s, set, go, press } = useP();
  const widen = canWiden(s.helper);
  const later = () => { set((x) => ({ ...x, askLater: { photo: x.request.photo ?? "bill", carried: true } })); go("Y"); };
  const wide = () => go("WA");
  const other = () => go("D", { reset: [...HOME, "D"], anim: "back" });
  return (
    <Frame title={t.W_title} cap={(x) => x.W_cap}
      spoken={(x) => x.W_spoken([...(widen ? [x.W_widen] : []), x.W_other, x.W_later])}
      voice={{
        q: (x) => x.W_q(widen),
        cmds: {
          ...(widen ? { widen: () => press("w-widen", (x) => x.cf.widen, wide) } : {}),
          other: () => press("w-other", (x) => x.cf.other, other),
          later: () => press("w-later", (x) => x.cf.sendLater, later),
        },
      }}
      actions={<ConfirmBtn id="w-later" msg={(x) => x.cf.sendLater} onConfirm={later}>{t.W_later}</ConfirmBtn>}>
      <Notice v="e" icon="al" title={t.W_cap} />
      <p>{t.W_p1}</p>
      <p className="hz-note">{t.W_p2}</p>
      {widen && <ConfirmBtn id="w-widen" cls="hz-bt hz-s" msg={(x) => x.cf.widen} onConfirm={wide}>{t.W_widen}</ConfirmBtn>}
      <ConfirmBtn id="w-other" cls="hz-bt hz-s" msg={(x) => x.cf.other} onConfirm={other}>{t.W_other}</ConfirmBtn>
    </Frame>
  );
}

function WidenToAnyone() {
  const { t, set, go, back, press } = useP();
  const yes = () => { set((x) => ({ ...x, request: { ...x.request, widened: true, volunteerId: null } })); go("H", { replace: true, anim: "fade" }); };
  return (
    <Frame title={t.WA_title} cap={(x) => x.WA_cap} spoken={(x) => x.WA_p} hideMic
      voice={{
        q: (x) => x.WA_q,
        parse: (x) => {
          const v = parseYesNo(x);
          if (v === "yes") return () => press("wa-yes", (y) => y.cf.waYes, yes);
          if (v === "no") return () => press("wa-no", (y) => y.cf.waNo, back);
          return null;
        },
      }}
      actions={<ConfirmBtn id="wa-yes" msg={(x) => x.cf.waYes} onConfirm={yes}>{t.WA_yes}</ConfirmBtn>}>
      <p>{t.WA_p}</p>
      <ListenRow />
      <ConfirmBtn id="wa-no" cls="hz-bt hz-s" msg={(x) => x.cf.waNo} onConfirm={back}>{t.WA_no}</ConfirmBtn>
    </Frame>
  );
}

function AskLater() {
  const { t, s, set, go, press, reask } = useP();
  const [photo, setPhoto] = useState<SampleItemId | null>(s.askLater.photo);
  const [rec, setRec] = useState<"idle" | "rec" | "done">("idle");
  const [sec, setSec] = useState(0);
  const recorded = () => reask({ mode: "listen", pre: (x) => `${x.Y_recordedSay} ${x.Y_q(!!photo, true)}` });
  useEffect(() => {
    if (rec !== "rec") return;
    const id = setInterval(() => setSec((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [rec]);
  const recordedRef = useRef(recorded);
  recordedRef.current = recorded;
  useEffect(() => {
    if (rec === "rec" && sec >= 5) { setRec("done"); recordedRef.current(); }
  }, [sec, rec]);
  const startRec = () => { stopListening(); setSec(0); setRec("rec"); };
  const stopRec = () => { setRec(sec > 0 ? "done" : "idle"); if (sec > 0) recorded(); };
  const addPhoto = () => {
    setPhoto("bill");
    reask({ mode: "listen", pre: (x) => `${x.Y_photoAdded(x.itemShort.bill)} ${x.Y_q(true, rec === "done")}` });
  };
  const canSend = !!photo || rec === "done";
  const send = () => {
    set((x) => ({ ...x, askLaterNumber: x.askLater.carried && x.request.number ? x.request.number : makeRequestNumber() }));
    go("YC", { reset: [...HOME, "YC"], anim: "fade" });
  };
  const recBody = (
    <>
      <Icon n={rec === "rec" ? "st" : rec === "done" ? "ck" : "mc"} s={28} />
      <span>
        {rec === "rec" ? t.Y_recording : rec === "done" ? t.Y_recorded : t.Y_record}
        <br /><span dir="ltr">{formatSeconds(sec)}</span> {t.sample}
      </span>
    </>
  );
  return (
    <Frame title={t.Y_title} cap={(x) => (rec === "rec" ? x.Y_recording : x.Y_cap)} spoken={(x) => x.Y_cap}
      voice={{
        q: (x) => x.Y_q(!!photo, rec === "done"),
        // No recognition while the 5-second recording is simulated.
        ...(rec === "rec" ? {} : {
          cmds: {
            ...(photo ? {} : { addPhoto: () => press("y-photo", (x) => x.cf.addPhoto, addPhoto) }),
            record: () => press("y-rec", (x) => x.cf.record, startRec),
            send: () => (canSend ? press("y-send", (x) => x.cf.send, send) : reask({ mode: "listen", pre: (x) => `${x.Y_need} ${x.Y_q(false, false)}` })),
          },
        }),
      }}
      actions={<>
        {!canSend && <p className="hz-note">{t.Y_need}</p>}
        <ConfirmBtn id="y-send" msg={(x) => x.cf.send} onConfirm={send} disabled={!canSend}>{t.Y_send}</ConfirmBtn>
      </>}>
      {photo ? (
        <Camera img={IMG[photo]} imgAlt={t.item[photo]} tag={t.item[photo]} />
      ) : (
        <>
          <Camera>{t.Y_photoPh}</Camera>
          <ConfirmBtn id="y-photo" cls="hz-bt hz-s" msg={(x) => x.cf.addPhoto} onConfirm={addPhoto}>{t.Y_addPhoto}</ConfirmBtn>
        </>
      )}
      {rec === "rec" ? (
        <button type="button" className="hz-bt hz-p" onClick={stopRec} aria-pressed="true">{recBody}</button>
      ) : (
        <ConfirmBtn id="y-rec" cls="hz-bt hz-s" msg={(x) => x.cf.record} onConfirm={startRec}>{recBody}</ConfirmBtn>
      )}
      {s.askLater.carried && s.helper && <p>{t.Y_carried(t.helper[s.helper], t.langName[s.lang])}</p>}
    </Frame>
  );
}

function AskLaterSent() {
  const { t, lang, s, go, press, armed, armListening, reask } = useP();
  const [ntf, setNtf] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setNtf(true), 5000);
    return () => clearTimeout(id);
  }, []);
  // The reply notification is spoken, then the app listens for "open".
  useEffect(() => {
    if (ntf) reask({ mode: "question" });
  }, [ntf, reask]);
  const no = s.askLaterNumber ?? "";
  const name = vName(ASK_LATER_REPLIER, lang);
  const on = armed === "yc-ntf";
  const openMsg: Say = (x, l) => x.cf.openReply(vName(ASK_LATER_REPLIER, l));
  const open = () => go("YR");
  return (
    <>
      <Frame title={t.YC_title} cap={(x, l) => (ntf ? x.YC_ntf(vName(ASK_LATER_REPLIER, l)) : x.YC_cap(no))} spoken={(x) => x.YC_cap(spellRequestNumber(no))}
        {...(ntf ? { voice: { noBackHint: true, q: (x, l) => x.YC_ntfSay(vName(ASK_LATER_REPLIER, l)), cmds: { open: () => press("yc-ntf", openMsg, open) } } } : {})}>
        <StatusCard label={t.status} status={t.stSent} numberLabel={t.requestNo} number={no} sample={t.sample} />
      </Frame>
      {ntf && (
        <button type="button" className="hz-ntf" aria-describedby={on ? "hz-hint-yc-ntf" : undefined} onClick={() => press("yc-ntf", openMsg, open)}>
          <Icon n="bl" />
          <span>
            <small>{t.YC_ntfFrom}</small>{t.YC_ntf(name)}
            {on && <ArmHint id="yc-ntf" listening={armListening} />}
          </span>
        </button>
      )}
    </>
  );
}

const REPLY_SECONDS = 8;
function VoiceReply() {
  const { t, lang, go, say, press, reask } = useP();
  const name = vName(ASK_LATER_REPLIER, lang);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [heard, setHeard] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const start = Date.now();
    const id = setInterval(() => setPos(Math.min(REPLY_SECONDS * 0.95, (Date.now() - start) / 1000)), 100);
    return () => clearInterval(id);
  }, [playing]);
  const play = () => {
    setHeard(true);
    setPos(0);
    setPlaying(true);
    void say((x, l) => x.YR_reply(vName(ASK_LATER_REPLIER, l))).then((ok) => {
      setPlaying(false);
      if (ok) { setPos(REPLY_SECONDS); reask({ mode: "question" }); }
    });
  };
  const stop = () => { cancelSpeech(); setPlaying(false); };
  const home = () => go("B", { reset: HOME, anim: "back" });
  const body = (
    <>
      <Icon n={playing ? "pa" : "pl"} s={28} />
      {playing ? t.YR_stop : t.YR_play}
    </>
  );
  return (
    <Frame title={t.YR_title} cap={(x, l) => (heard ? x.YR_reply(vName(ASK_LATER_REPLIER, l)) : x.YR_cap)} spoken={(x) => x.YR_cap}
      voice={{
        q: (x) => x.YR_q,
        cmds: { ...(playing ? {} : { play: () => press("yr-play", (x) => x.cf.play, play) }), home: () => press("yr-home", (x) => x.cf.backHome, home) },
      }}
      actions={<ConfirmBtn id="yr-home" msg={(x) => x.cf.backHome} onConfirm={home}>{t.backHome}</ConfirmBtn>}>
      <p>{t.YR_from(name)}</p>
      {playing ? (
        <button type="button" className="hz-bt hz-p" onClick={stop}>{body}</button>
      ) : (
        <ConfirmBtn id="yr-play" cls="hz-bt hz-s" msg={(x) => x.cf.play} onConfirm={play}>{body}</ConfirmBtn>
      )}
      <div className="hz-plbar" aria-hidden="true">
        <div className="hz-bar"><i style={{ width: `${(pos / REPLY_SECONDS) * 100}%` }} /></div>
        <span><span className="t">{formatSeconds(Math.floor(pos))} / {formatSeconds(REPLY_SECONDS)}</span> {t.sample}</span>
      </div>
    </Frame>
  );
}

/* ---------- Welcome (tap only) ---------- */

function Welcome() {
  const { t, go, set } = useP();
  const open = (signup: boolean) => { set((x) => ({ ...x, signup })); go("A"); };
  return (
    <Frame noBack hideCap title={t.WEL_title} strip={<></>}
      actions={<>
        <Btn large onClick={() => open(false)}>{t.WEL_login}</Btn>
        <Btn large kind="s" onClick={() => open(true)}>{t.WEL_signup}</Btn>
      </>}>
      <p className="hz-wel">{t.WEL_line}</p>
    </Frame>
  );
}

/* ---------- Blind-user sign-up: step 1 is Choose language; steps 2 to 5 are below (sample data only) ---------- */

function StepLine({ n }: { n: number }) {
  const { t } = useP();
  return <p className="hz-step">{t.setupStep(n, SETUP_STEPS)}</p>;
}
/** Every sign-up screen speaks its step line first. */
const stepSay = (x: Strings, n: number, text: string) => `${x.setupStep(n, SETUP_STEPS)}. ${text}`;

function SetupTerms() {
  const { t, go } = useP();
  const next = () => go("S3");
  return (
    <Frame title={t.S2_title} cap={(x) => stepSay(x, 2, `${x.S2_p1} ${x.S2_p2} ${x.S2_p3}`)}
      voice={{ q: (x) => x.S2_q, options: (x) => x.S2_opts, parse: (x) => (parseAccept(x) ? next : null) }}>
      <StepLine n={2} />
      <div className="hz-terms">
        <h2>{t.S2_h1}</h2>
        <p>{t.S2_p1}</p>
        <h2>{t.S2_h2}</h2>
        <p>{t.S2_p2}</p>
        <h2>{t.S2_h3}</h2>
        <p>{t.S2_p3}</p>
        <p className="q">{t.S2_q}</p>
      </div>
    </Frame>
  );
}

/** Association first, then CNIC. The CNIC is never kept, shown, spoken back or logged: only the fixed mask is shown. */
function SetupVerify() {
  const { t, go, say, press, reask } = useP();
  const [phase, setPhase] = useState<"assoc" | "cnic" | "done">("assoc");
  const [assoc, setAssoc] = useState("");
  const next = () => go("S4");

  // While the CNIC is being heard the status lines show the mask; always switched off when leaving.
  useEffect(() => {
    setPrivateListening(phase === "cnic");
    return () => setPrivateListening(false);
  }, [phase]);
  // After each answer: say what happened, then ask the next question.
  useEffect(() => {
    if (phase === "cnic") reask({ mode: "question", pre: (x) => x.S3_echoAssoc(assoc) });
    if (phase === "done") reask({ mode: "question", pre: (x) => x.S3_done });
  }, [phase, assoc, reask]);

  const voice: ScreenVoice =
    phase === "done"
      ? { q: (x) => x.S3_qNext, cmds: { continue: () => press("s3-next", (x) => x.cf.signupNext, next) } }
      : phase === "cnic"
        ? { q: (x) => x.S3_qCnic, parse: (x) => (parseFreeAnswer(x) ? () => setPhase("done") : null) }
        : {
          retry: () => say((x) => `${x.notHeardQ} ${x.S3_qAssoc}`),
          parse: (x) => {
            const a = parseFreeAnswer(x);
            return a ? () => { setAssoc(a); setPhase("cnic"); } : null;
          },
        };
  return (
    <Frame title={t.S3_title} cap={(x) => (phase === "assoc" ? stepSay(x, 3, x.S3_cap) : "")} voice={voice}
      actions={<ConfirmBtn id="s3-next" msg={(x) => x.cf.signupNext} onConfirm={next} disabled={phase !== "done"}>{t.S_continue}</ConfirmBtn>}>
      <StepLine n={3} />
      <p className="hz-lead">{t.S3_cap}</p>
      {assoc && <div className="hz-card">{t.S3_assocLabel(assoc)}</div>}
      {phase === "done" && (
        <>
          <div className="hz-card">{t.S3_cnicLabel}: <span dir="ltr">{MASKED_CNIC}</span></div>
          <div className="hz-fade-in"><Notice v="ok" icon="ck" title={t.S3_done} /></div>
        </>
      )}
    </Frame>
  );
}

function SetupGender() {
  const { t, go, press, armed } = useP();
  const next = () => go("S5");
  const options: Gender[] = ["woman", "man", "none"];
  return (
    <Frame title={t.S4_title} cap={(x) => stepSay(x, 4, x.S4_cap)} hideMic
      voice={{
        q: (x) => x.S4_q,
        options: (x) => x.S4_opts,
        parse: (x) => {
          const g = parseGender(x);
          return g ? () => press(`gd-${g}`, (y) => y.cf.gender(g), next) : null;
        },
      }}>
      <StepLine n={4} />
      <p className="hz-lead">{t.S4_cap}</p>
      <ListenRow />
      {options.map((g) => (
        <ConfirmBtn key={g} id={`gd-${g}`} cls="hz-bt hz-s" msg={(x) => x.cf.gender(g)} onConfirm={next}>{t.genderLabel[g]}</ConfirmBtn>
      ))}
      {armed === "gd-none" && <div className="hz-fade-in"><Notice v="i" icon="in">{t.S4_none}</Notice></div>}
    </Frame>
  );
}

function SetupDone() {
  const { t, go, set, press } = useP();
  // The language chosen in step 1 is already in the session, so Home opens in it.
  const finish = () => { set((x) => ({ ...x, signup: false })); go("B", { reset: HOME, anim: "fade" }); };
  return (
    <Frame title={t.S5_title} cap={(x) => stepSay(x, 5, x.S5_cap)}
      voice={{ q: (x) => x.S5_q, cmds: { continue: () => press("s5-next", (x) => x.cf.signupDone, finish) } }}
      actions={<ConfirmBtn id="s5-next" msg={(x) => x.cf.signupDone} onConfirm={finish}>{t.S_continue}</ConfirmBtn>}>
      <StepLine n={5} />
      <p className="hz-lead">{t.S5_cap} {t.S5_q}</p>
    </Frame>
  );
}

/* ---------- Volunteer ---------- */

function WhatsApp() {
  const { t, s, set, go } = useP();
  const join = () => {
    if (s.linkUsed) { go("V2x", { anim: "fade" }); return; }
    set((x) => ({ ...x, linkUsed: true }));
    go("V3");
  };
  return (
    <Frame title={t.V1_title} caption={t.V1_cap} actions={<Btn onClick={join}>{t.V1_join}</Btn>}>
      <div className="hz-mb"><small>{t.V1_from}</small>{t.V1_msg}<small>{t.V1_time}</small></div>
      <div className="hz-card"><small>{t.V1_sms}</small></div>
    </Frame>
  );
}

function LinkExpired() {
  const { t, go } = useP();
  return (
    <Frame title={t.V2x_title} caption={t.V2x_cap} actions={<Btn onClick={() => go("A", { reset: ["A"], anim: "back" })}>{t.startOver}</Btn>}>
      <Notice v="e" icon="al" title={t.V2x_cap} />
      <p>{t.V2x_p}</p>
    </Frame>
  );
}

function VolunteerRule() {
  const { t, go } = useP();
  return (
    <Frame title={t.V3_title} caption={t.V3_rule}
      actions={<>
        <Btn onClick={() => go("VM")}>{t.V3_join}</Btn>
        <Btn kind="s" onClick={() => go("V5")}>{t.V3_cant}</Btn>
      </>}>
      <p className="hz-ru">{t.V3_rule}</p>
      {t.V3_no.map((x) => <Tip key={x} icon="x" no>{x}</Tip>)}
      <p>{t.V3_link}</p>
    </Frame>
  );
}

function DeclineReasons() {
  const { t, go } = useP();
  const [pick, setPick] = useState<number | null>(null);
  return (
    <Frame title={t.V5_title} caption={pick === null ? t.V5_cap : t.V5_thanks}
      actions={<Btn onClick={() => go("A", { reset: ["A"], anim: "back" })}>{t.startOver}</Btn>}>
      <div role="radiogroup" aria-label={t.V5_cap} style={{ display: "contents" }}>
        {t.V5_reasons.map((r, i) => (
          <button key={r} type="button" role="radio" aria-checked={pick === i} className={`hz-rd${pick === i ? " on" : ""}`} onClick={() => setPick(i)}>
            <i aria-hidden="true" />{r}
          </button>
        ))}
      </div>
      {pick !== null && <div className="hz-fade-in"><Notice v="ok" icon="ck" title={t.V5_thanks} /></div>}
    </Frame>
  );
}

function VolunteerCall() {
  const { t, lang, confirmEnd } = useP();
  const p = t.VM_p(USER_FIRST_NAME[lang]);
  const cut = p.indexOf(" (");
  return (
    <Frame title={t.VM_title} caption={t.VM_cap} actions={<Btn onClick={confirmEnd}>{t.VM_end}</Btn>}>
      <Camera tall img={medicineImg} imgAlt={t.item.medicine} tag={t.cameraSample} />
      <p><b>{p.slice(0, cut)}</b>{p.slice(cut)}</p>
    </Frame>
  );
}

function ThankYou() {
  const { t, go } = useP();
  const [showNo, setShowNo] = useState(false);
  return (
    <Frame title={t.VT_title} caption={t.VT_cap} actions={<Btn onClick={() => go("A", { reset: ["A"], anim: "back" })}>{t.startOver}</Btn>}>
      <p>{t.VT_p}</p>
      <div className="hz-card"><small>{t.VT_month}</small><div className="hz-ru">{t.VT_helped}</div></div>
      <Toggle on={showNo} onChange={setShowNo} label={t.showNumber} onText={t.numberShown} offText={t.numberHidden} />
    </Frame>
  );
}

const SU_LANGS = ["Urdu", "English", "Punjabi", "Sindhi", "Pashto", "Saraiki", "Balochi"];
const SU_FREE = ["Morning", "Afternoon", "Evening", "Late night", "Weekends"];
const SU_RULES = ["No medicine dose advice", "No PINs or OTPs", "No legal or money advice", "No guiding on stairs or roads", "Not for emergencies"];
type SuStep = { q: string; kind: "text" | "multi" | "single" | "rules"; opts?: string[]; reply?: string };
const SU_STEPS: SuStep[] = [
  { q: "What nickname should people see?", kind: "text" },
  { q: "Which languages can you help in? Pick all that apply.", kind: "multi", opts: SU_LANGS },
  { q: "When are you usually free?", kind: "multi", opts: SU_FREE },
  { q: "How should we contact you?", kind: "single", opts: ["WhatsApp", "SMS", "App notification"] },
  { q: "Are you 18 or older?", kind: "single", opts: ["Yes", "No"] },
  { q: "Please send a photo of your CNIC for ID verification. It is never shown to the people you help.", kind: "single", opts: ["Send CNIC photo (sample)"], reply: "CNIC photo sent (sample)" },
  { q: "Describe what you see. Don’t decide for them.", kind: "rules", opts: ["I accept"] },
  { q: "Your gender (used for matching only)", kind: "single", opts: ["Woman", "Man", "Prefer not to say"] },
  { q: "Who would you like to help?", kind: "single", opts: ["Anyone", "Women only", "Men only"] },
  { q: "Send me requests?", kind: "single", opts: ["Yes, send me requests"] },
];
const SU_AGE = 4;
const SU_LAST = SU_STEPS.length - 1;
const toggleIn = (set: (fn: (x: string[]) => string[]) => void, v: string) =>
  set((x) => (x.includes(v) ? x.filter((i) => i !== v) : [...x, v]));
const rowStyle = { display: "flex", flexWrap: "wrap", gap: 8 } as const;

function VolunteerSignup() {
  const { t, go } = useP();
  const [step, setStep] = useState(0);
  const [replies, setReplies] = useState<string[]>([]);
  const [nick, setNick] = useState("Sana (sample)");
  const [pick, setPick] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const goRef = useRef(go);
  goRef.current = go;
  const sorry = replies[SU_AGE] === "No";
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [step, sorry]);
  useEffect(() => {
    if (!sorry) return;
    const id = window.setTimeout(() => goRef.current("WEL", { reset: ["WEL"], anim: "back" }), 2500);
    return () => window.clearTimeout(id);
  }, [sorry]);

  const answer = (text: string) => {
    if (step === SU_LAST) { go("VL"); return; }
    setReplies((r) => [...r, text]);
    setPick([]);
    setStep((n) => n + 1);
  };
  const cur = SU_STEPS[step];
  const showControls = !sorry && !!cur && replies.length === step;
  const mine = { alignSelf: "flex-end", background: "var(--hz-at)", borderEndStartRadius: 16, borderEndEndRadius: 4 } as const;
  const bot = (i: number) => {
    const q = SU_STEPS[i];
    if (!q) return null;
    if (q.kind !== "rules") return <div key={`q${i}`} className="hz-mb" style={{ alignSelf: "flex-start" }}>{q.q}</div>;
    return (
      <div key={`q${i}`} className="hz-card" style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
        <div className="hz-ru">{q.q}</div>
        {SU_RULES.map((x) => <Tip key={x} icon="x" no>{x}</Tip>)}
        <small>If these rules change, we will ask you to accept again.</small>
      </div>
    );
  };

  return (
    <Frame title={t.VS_title} caption={t.VS_cap}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SU_STEPS.slice(0, step + 1).map((_, i) => (
          <div key={i} style={{ display: "contents" }}>
            {bot(i)}
            {i < replies.length && <div className="hz-mb" style={mine}>{replies[i]}</div>}
          </div>
        ))}
        {sorry && <div className="hz-mb" style={{ alignSelf: "flex-start" }}>Sorry, volunteers must be 18 or older.</div>}
        {showControls && cur.kind === "text" && (
          <>
            <input type="text" aria-label={cur.q} value={nick} onChange={(e) => setNick(e.target.value)}
              style={{ boxSizing: "border-box", width: "100%", minHeight: 56, padding: "8px 16px", border: "2px solid var(--hz-n500)", borderRadius: 12, font: "18px/24px var(--font-sans)" }} />
            <Btn disabled={!nick.trim()} onClick={() => answer(nick.trim())}>Send</Btn>
          </>
        )}
        {showControls && cur.kind === "multi" && (
          <>
            <div role="group" aria-label={cur.q} style={rowStyle}>
              {cur.opts?.map((o) => <Chip key={o} on={pick.includes(o)} onClick={() => toggleIn(setPick, o)}>{o}</Chip>)}
            </div>
            <Btn disabled={pick.length === 0} onClick={() => answer(pick.join(", "))}>Send</Btn>
          </>
        )}
        {showControls && (cur.kind === "single" || cur.kind === "rules") &&
          cur.opts?.map((o) => <Btn key={o} onClick={() => answer(cur.reply ?? o)}>{o}</Btn>)}
        <div ref={endRef} />
      </div>
    </Frame>
  );
}

const SU_SLOTS = ["Weekday mornings", "Weekday evenings", "Late nights", "Weekends"];
const SU_MONTH = ["1–2", "3–5", "6–10"];
const SU_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SU_STATUS = ["Free", "Busy", "Stop"];

function VolunteerLimits() {
  const { go } = useP();
  const [slots, setSlots] = useState<string[]>([]);
  const [month, setMonth] = useState("3–5");
  const [quiet, setQuiet] = useState<string[]>([]);
  const [calls, setCalls] = useState(2);
  const [status, setStatus] = useState("Free");
  return (
    <Frame title="You can change these anytime" caption="Your limits"
      actions={<Btn onClick={() => go("V1")}>Save and see a sample request</Btn>}>
      <div>
        <div className="hz-lbl">Weekly slots</div>
        <div role="group" aria-label="Weekly slots" style={rowStyle}>
          {SU_SLOTS.map((o) => <Chip key={o} on={slots.includes(o)} onClick={() => toggleIn(setSlots, o)}>{o}</Chip>)}
        </div>
      </div>
      <div>
        <div className="hz-lbl">Requests per month</div>
        <div role="radiogroup" aria-label="Requests per month" style={rowStyle}>
          {SU_MONTH.map((o) => <Chip key={o} on={month === o} onClick={() => setMonth(o)}>{o}</Chip>)}
        </div>
      </div>
      <div>
        <div className="hz-lbl">Quiet days</div>
        <div role="group" aria-label="Quiet days" style={rowStyle}>
          {SU_DAYS.map((o) => <Chip key={o} on={quiet.includes(o)} onClick={() => toggleIn(setQuiet, o)}>{o}</Chip>)}
        </div>
      </div>
      <div>
        <div className="hz-lbl">Calls from the same friend per week</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button type="button" className="hz-bt hz-s" style={{ width: 56 }} aria-label="Fewer calls" disabled={calls <= 1} onClick={() => setCalls((n) => n - 1)}>−</button>
          <span className="hz-ru" aria-live="polite">{calls}</span>
          <button type="button" className="hz-bt hz-s" style={{ width: 56 }} aria-label="More calls" disabled={calls >= 7} onClick={() => setCalls((n) => n + 1)}>+</button>
        </div>
      </div>
      <div>
        <div className="hz-lbl">Status</div>
        <div role="radiogroup" aria-label="Status" style={rowStyle}>
          {SU_STATUS.map((o) => <Chip key={o} on={status === o} onClick={() => setStatus(o)}>{o}</Chip>)}
        </div>
        <p>You can also reply Busy, Free or Stop in WhatsApp.</p>
      </div>
    </Frame>
  );
}

const SCREENS: Record<ScreenId, () => ReactNode> = {
  WEL: Welcome, VS: VolunteerSignup, VL: VolunteerLimits, S2: SetupTerms, S3: SetupVerify, S4: SetupGender, S5: SetupDone,
  A: StartScreen, L: ChooseLanguage, B: Home, D: ChooseHelpType, QP: QuickLookPhoto, F: HumanNeeded, Q: QuickLookAnswer,
  G: ChooseHelper, T: BeforeCall, H: Waiting, M: LiveCall, R: CallEnded, CD: RequestComplete,
  W: NoVolunteer, WA: WidenToAnyone, Y: AskLater, YC: AskLaterSent, YR: VoiceReply,
  V1: WhatsApp, V2x: LinkExpired, V3: VolunteerRule, V5: DeclineReasons, VM: VolunteerCall, VT: ThankYou,
};

/* ---------- Shell ---------- */

/** onBack "repeat": saying back during this confirm asks the same question again (Live call's "End the call?"). */
type Arm = { id: string; msg: Say; action: () => void; lang?: Lang | undefined; onBack?: "repeat" };

export function Prototype() {
  const [s, setS] = useState<Session>(initialSession);
  const [stack, setStack] = useState<ScreenId[]>(["WEL"]);
  const [anim, setAnim] = useState<Anim>("fade");
  const [navKey, setNavKey] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [armListening, setArmListening] = useState(false);
  const [voice, setVoice] = useState<VoiceState>("unknown");
  const [mic, setMicState] = useState<Mic>({ s: "idle" });
  const [blocked, setBlocked] = useState(false);
  const phoneRef = useRef<HTMLDivElement>(null);
  const screen: ScreenId = stack[stack.length - 1] ?? "A";
  const blind = !VOLUNTEER_SCREENS.includes(screen);
  const t = STRINGS[s.lang];

  const langRef = useRef<Lang>(s.lang);
  langRef.current = s.lang;
  const voiceRef = useRef<VoiceState>("unknown");
  const voiceAnnounced = useRef(false);
  const armRef = useRef<Arm | null>(null);
  const flowRef = useRef(0);
  const screenAskRef = useRef<((o?: AskOpts) => Promise<void>) | null>(null);
  const backRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!recognitionSupported()) { voiceRef.current = "off"; setVoice("off"); }
  }, []);

  const begin = useCallback(() => ++flowRef.current, []);
  const isCurrent = useCallback((n: number) => flowRef.current === n, []);
  const setMic = useCallback((m: Mic) => setMicState(m), []);
  const registerScreen = useCallback<Ctx["registerScreen"]>((fn) => { screenAskRef.current = fn; }, []);
  const reask = useCallback<Ctx["reask"]>((o) => { void screenAskRef.current?.(o); }, []);
  const setLang = useCallback((l: Lang) => { langRef.current = l; setS((x) => ({ ...x, lang: l })); }, []);

  /** Speaks in the app language; Urdu falls back to the English text when no Urdu voice is installed. Never listens while speaking. */
  const say = useCallback((build: Say, langOverride?: Lang) => {
    stopListening();
    const want = langOverride ?? langRef.current;
    const l: Lang = want === "ur" && !hasUrduVoice() ? "en" : want;
    return speak(build(STRINGS[l], l), l);
  }, []);

  const markVoiceOff = useCallback(async () => {
    voiceRef.current = "off";
    setVoice("off");
    if (voiceAnnounced.current) return;
    voiceAnnounced.current = true;
    await say((x) => x.voiceOff);
  }, [say]);
  const markBlocked = useCallback(async () => {
    voiceRef.current = "off";
    setVoice("off");
    setBlocked(true);
    if (voiceAnnounced.current) return;
    voiceAnnounced.current = true;
    await say((x) => x.micBlocked);
  }, [say]);
  const markVoiceOk = useCallback(() => {
    if (voiceRef.current !== "ok") { voiceRef.current = "ok"; setVoice("ok"); }
  }, []);

  const clearArm = useCallback(() => {
    armRef.current = null;
    setArmed(null);
    setArmListening(false);
  }, []);

  /** Listens up to 8 s, twice: "I did not hear you" only when nothing was heard; otherwise heardRetry ("I heard …"). */
  const hear = useCallback(async <T,>(token: number, o: HearOpts<T>): Promise<HearResult<T>> => {
    const tries = 2;
    for (let attempt = 0; attempt < tries; attempt++) {
      o.onListen?.(true);
      const lang = typeof o.lang === "function" ? o.lang(attempt) : (o.lang ?? langRef.current);
      const r = await listen(lang, LISTEN_MS);
      if (!isCurrent(token)) return { s: "stop" };
      o.onListen?.(false);
      if (r.status === "aborted") return { s: "stop" };
      if (r.status === "blocked") { await markBlocked(); return { s: "stop" }; }
      if (r.status === "unavailable") { await markVoiceOff(); return { s: "stop" }; }
      const heard = r.status === "ok" ? r.text.trim() : "";
      if (r.status === "ok") {
        markVoiceOk();
        for (const alt of r.alternatives) {
          const hit = o.match(alt);
          if (hit !== null && hit !== undefined) { reportHeard(alt, true); return { s: "hit", hit, text: alt }; }
        }
        reportHeard(r.text, false);
      }
      const useHeard = !!heard && !!o.heardRetry;
      if (o.quiet && !useHeard) return { s: "stop" };
      if (attempt < tries - 1) {
        o.onMiss?.(heard);
        const ok = useHeard && o.heardRetry ? await o.heardRetry(heard) : await o.retry();
        if (!ok || !isCurrent(token)) return { s: "stop" };
      }
    }
    return o.quiet ? { s: "stop" } : { s: "fail" };
  }, [langRef, isCurrent, markBlocked, markVoiceOff, markVoiceOk]);

  /** Speaks what the choice does, then listens for confirm, cancel, repeat or back. */
  const runConfirm = useCallback(async (a: Arm): Promise<void> => {
    const token = begin();
    stopListening();
    setMic({ s: "idle" });
    armRef.current = a;
    setArmed(a.id);
    setArmListening(false);
    const ok = await say(a.msg, a.lang);
    if (!ok || !isCurrent(token) || voiceRef.current === "off") return;
    const r = await hear(token, { lang: a.lang, match: parseConfirm, retry: () => say((x) => x.notHeard, a.lang), onListen: setArmListening });
    if (r.s !== "hit") return;
    if (r.hit === "confirm") { clearArm(); a.action(); return; }
    if (r.hit === "cancel") { clearArm(); reask({ mode: "question" }); return; }
    if (r.hit === "repeat") { void runConfirm(a); return; }
    if (r.hit === "back") {
      if (a.onBack === "repeat") { void runConfirm(a); return; }
      clearArm(); backRef.current(); return;
    }
  }, [begin, isCurrent, setMic, say, hear, clearArm, reask]);

  const press = useCallback<Ctx["press"]>((id, msg, action, lang) => {
    // Silent fallback for evaluators: a second tap on the same choice runs it.
    if (armRef.current?.id === id) {
      begin();
      clearArm();
      stopListening();
      cancelSpeech();
      action();
      return;
    }
    void runConfirm({ id, msg, action, lang });
  }, [begin, clearArm, runConfirm]);

  const tapRepeat = useCallback(() => {
    const a = armRef.current;
    if (a) void runConfirm(a);
    else reask({ mode: "full" });
  }, [runConfirm, reask]);

  const leave = useCallback(() => {
    begin();
    clearArm();
    stopListening();
    cancelSpeech();
    setMic({ s: "idle" });
  }, [begin, clearArm, setMic]);

  const go = useCallback<Ctx["go"]>((to, opts = {}) => {
    leave();
    setStack((st) => (opts.reset ? opts.reset : opts.replace ? [...st.slice(0, -1), to] : [...st, to]));
    setAnim(opts.anim ?? "fwd");
    setNavKey((k) => k + 1);
  }, [leave]);
  const endCall = useCallback(() => {
    setConfirm(false);
    if (screen === "M") go("R", { reset: [...HOME, "R"], anim: "fade" });
    else go("VT", { reset: ["A", "VT"], anim: "fade" });
  }, [screen, go]);
  const pop = useCallback(() => {
    leave();
    setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
    setAnim("back");
    setNavKey((k) => k + 1);
  }, [leave]);
  const back = useCallback(() => {
    if (screen === "M" || screen === "VM") {
      leave();
      setConfirm(true);
      return;
    }
    pop();
  }, [screen, leave, pop]);
  // Spoken "back": on Live call it asks "End the call? Say confirm or cancel." and goes back only on confirm.
  const voiceBack = useCallback(() => {
    if (screen === "M") { void runConfirm({ id: "m-back", msg: (x) => x.M_backQ, action: pop, onBack: "repeat" }); return; }
    back();
  }, [screen, runConfirm, pop, back]);
  backRef.current = voiceBack;
  const closeDialog = useCallback(() => {
    leave();
    setConfirm(false);
    if (screen === "M") reask({ mode: "question" });
  }, [leave, screen, reask]);

  useEffect(() => () => { stopListening(); cancelSpeech(); }, []);

  // Move focus to the new screen title so screen readers announce it.
  useEffect(() => {
    if (navKey === 0) return;
    phoneRef.current?.querySelector<HTMLElement>("[data-screen-title]")?.focus();
  }, [navKey]);

  const Screen = SCREENS[screen];
  const set = useCallback((fn: (s: Session) => Session) => setS(fn), []);
  const ctx: Ctx = {
    t, lang: s.lang, langRef, setLang, s, blind, set, go, back, voiceBack, confirmEnd: () => setConfirm(true),
    say, press, armed, armListening, tapRepeat, reask, registerScreen, begin, isCurrent, clearArm,
    mic, setMic, voiceRef, voice, markVoiceOff, markBlocked, blocked, markVoiceOk, hear,
  };

  // Choose language for a volunteer: no voice at all, taps work as normal.
  const volunteerLang = screen === "L" && s.role === "volunteer";
  // Tapping empty space on a blind-user screen repeats the prompt and listens again.
  const onEmptyTap = (e: MouseEvent) => {
    // Start is not a blind-user screen, but its first tap anywhere starts the voice (and later taps repeat it).
    if (!blind && screen !== "A") return;
    if (volunteerLang) return;
    if ((e.target as HTMLElement).closest("button, a, input, label, [role=radio], [role=switch]")) return;
    tapRepeat();
  };
  // Blind-user screens: a tap on any control never selects or navigates; it only repeats the prompt.
  // Start and volunteer screens (and Choose language for a volunteer) keep their taps.
  const tapsHarmless = blind && screen !== "A" && !volunteerLang;
  const onControlTapCapture = (e: MouseEvent) => {
    if (!tapsHarmless) return;
    if (!(e.target as HTMLElement).closest("button, a, input, label, [role=button], [role=radio], [role=switch]")) return;
    e.preventDefault();
    e.stopPropagation();
    tapRepeat();
  };

  return (
    <PrototypeContext.Provider value={ctx}>
      <main className="hz-stage">
        <div ref={phoneRef} className="hz-ph" dir={s.lang === "ur" ? "rtl" : "ltr"} lang={s.lang} aria-label="Humnazar prototype">
          <div className="hz-sb" dir="ltr" aria-hidden="true"><span>9:41</span><span>4G</span></div>
          <div key={navKey} className={`hz-screen hz-anim-${anim}${blind ? " hz-blind" : ""}`} onClickCapture={onControlTapCapture} onClick={onEmptyTap}>
            <Screen />
          </div>
          <div className="hz-hi" aria-hidden="true"><i /></div>
          {confirm && <EndCallDialog onYes={endCall} onNo={closeDialog} />}
        </div>
      </main>
    </PrototypeContext.Provider>
  );
}

function EndCallDialog({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  const { t, blind, say, begin, isCurrent, langRef, voiceRef, markBlocked } = useP();
  const noRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef(onYes);
  yesRef.current = onYes;
  const noFn = useRef(onNo);
  noFn.current = onNo;
  // Blind users: taps on the dialog only repeat its question (bumping this restarts the voice loop).
  const [repeat, setRepeat] = useState(0);
  const tap = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    if (blind) setRepeat((n) => n + 1);
    else fn();
  };
  useEffect(() => {
    noRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onNo(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNo]);
  // Blind users answer the dialog by voice: yes ends the call, no stays on it.
  useEffect(() => {
    if (!blind) return;
    const token = begin();
    void (async () => {
      let ok = await say((x) => `${x.M_confirm} ${x.M_confirmBody} ${x.M_confirmQ}`);
      if (!ok || !isCurrent(token) || voiceRef.current === "off") return;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await listen(langRef.current, LISTEN_MS);
        if (!isCurrent(token)) return;
        if (r.status === "aborted" || r.status === "unavailable") return;
        if (r.status === "blocked") { await markBlocked(); return; }
        if (r.status === "ok") {
          for (const alt of r.alternatives) {
            const c = parseConfirm(alt);
            const v = parseYesNo(alt) ?? (c === "confirm" ? "yes" : c === "cancel" ? "no" : null);
            if (v === "yes") { reportHeard(alt, true); yesRef.current(); return; }
            if (v === "no") { reportHeard(alt, true); noFn.current(); return; }
          }
          reportHeard(r.text, false);
        }
        if (attempt === 0) {
          ok = await say((x) => `${x.notHeardQ} ${x.M_confirmQ}`);
          if (!ok || !isCurrent(token)) return;
        }
      }
    })();
  }, [blind, begin, isCurrent, say, langRef, voiceRef, markBlocked, repeat]);
  return (
    <div className={`hz-scrim${blind ? " hz-blind" : ""}`} onClick={tap(onNo)}>
      <div className="hz-dlg" role="alertdialog" aria-modal="true" aria-labelledby="hz-dlg-t" aria-describedby="hz-dlg-d" onClick={tap(() => {})}>
        <h2 id="hz-dlg-t">{t.M_confirm}</h2>
        <p id="hz-dlg-d" style={{ margin: 0 }}>{t.M_confirmBody}</p>
        <button type="button" className="hz-bt hz-p" onClick={tap(onYes)}>{t.M_yes}</button>
        <button type="button" ref={noRef} className="hz-bt hz-s" onClick={tap(onNo)}>{t.M_no}</button>
      </div>
    </div>
  );
}
