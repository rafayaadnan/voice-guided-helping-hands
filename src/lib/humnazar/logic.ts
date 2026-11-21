// Humnazar prototype rules. All people and outcomes are local sample data.

export type Lang = "en" | "ur";
export type Helper = "friend" | "woman" | "man" | "anyone";
export type VolunteerStatus = "free" | "away" | "busy";
export type SampleItemId = "spice" | "medicine" | "shirt" | "bill";
export type ItemKind = "food" | "medicine" | "money" | "bill" | "form" | "health" | "safety" | "style";

export interface Volunteer {
  id: string;
  name: Record<Lang, string>;
  gender: "man" | "woman";
  friend: boolean;
  status: VolunteerStatus;
}

export const USER_FIRST_NAME: Record<Lang, string> = { en: "Farah", ur: "فرح" };

export const VOLUNTEERS: Volunteer[] = [
  { id: "bilal", name: { en: "Bilal", ur: "بلال" }, gender: "man", friend: true, status: "free" },
  { id: "usman", name: { en: "Usman", ur: "عثمان" }, gender: "man", friend: true, status: "away" },
  { id: "imran", name: { en: "Imran", ur: "عمران" }, gender: "man", friend: false, status: "free" },
  { id: "hira", name: { en: "Hira", ur: "حرا" }, gender: "woman", friend: false, status: "busy" },
  { id: "noor", name: { en: "Noor", ur: "نور" }, gender: "woman", friend: false, status: "busy" },
];

export const ASK_LATER_REPLIER = "noor";

export function volunteer(id: string): Volunteer {
  const v = VOLUNTEERS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown volunteer ${id}`);
  return v;
}

/** Volunteers who match a helper choice (friends = the user's starting friends list). */
export function matchingVolunteers(helper: Helper): Volunteer[] {
  switch (helper) {
    case "friend":
      return VOLUNTEERS.filter((v) => v.friend);
    case "woman":
      return VOLUNTEERS.filter((v) => v.gender === "woman");
    case "man":
      return VOLUNTEERS.filter((v) => v.gender === "man");
    case "anyone":
      return VOLUNTEERS;
  }
}

// Sample outcomes from the brief: friend -> Bilal; man / anyone / widened -> Imran; woman -> nobody.
const ACCEPTED_BY: Record<Helper, string | null> = {
  friend: "bilal",
  man: "imran",
  anyone: "imran",
  woman: null,
};

/** Who accepts the call for this helper choice, or null when no one accepts within 60 seconds. */
export function acceptingVolunteer(helper: Helper): Volunteer | null {
  const id = ACCEPTED_BY[helper];
  if (!id) return null;
  const v = volunteer(id);
  return v.status === "free" ? v : null;
}

/** "Widen to anyone" is offered only when a woman or a man was asked for. */
export function canWiden(helper: Helper | null): boolean {
  return helper === "woman" || helper === "man";
}

/** Demo timing: the 60-second wait runs in about 5 real seconds; acceptance lands at about 4. */
export const WAIT_SECONDS = 60;
export const DEMO_WAIT_MS = 5000;
export const DEMO_ACCEPT_MS = 4000;
export const demoTickMs = DEMO_WAIT_MS / WAIT_SECONDS;
export const acceptAtSecondsLeft = WAIT_SECONDS - Math.round(DEMO_ACCEPT_MS / demoTickMs);

const HUMAN_KINDS: ItemKind[] = ["medicine", "money", "bill", "form", "health", "safety", "style"];

/** Medicine, money, bills, forms, health, safety and style questions always need a person. */
export function needsHuman(kind: ItemKind): boolean {
  return HUMAN_KINDS.includes(kind);
}

export const SAMPLE_ITEM_KIND: Record<SampleItemId, ItemKind> = {
  spice: "food",
  medicine: "medicine",
  shirt: "style",
  bill: "bill",
};

/** Request number format HNZ-[MMDD]-[4 digits], e.g. HNZ-1115-4827. */
export function makeRequestNumber(date: Date = new Date(), random: () => number = Math.random): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const digits = String(Math.floor(random() * 10000)).padStart(4, "0");
  return `HNZ-${mm}${dd}-${digits}`;
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export type Role = "user" | "volunteer";
/** Both roles choose a language straight after Start; then users go Home and volunteers to the WhatsApp message. */
export function afterLanguage(role: Role): "B" | "V1" {
  return role === "user" ? "B" : "V1";
}
/** After Choose language: in sign-up a blind user goes on to the terms (step 2); otherwise as before. */
export function afterLanguageFor(role: Role, signup: boolean): "B" | "V1" | "S2" {
  return signup && role === "user" ? "S2" : afterLanguage(role);
}
/** After Start: log in goes to Choose language for both roles; sign-up sends a volunteer to "coming next". */
export function afterStart(signup: boolean, role: Role): "L" | "VS" {
  return signup && role === "volunteer" ? "VS" : "L";
}

/* ---------- Blind-user sign-up (sample data only, nothing is stored) ---------- */
export type Gender = "woman" | "man" | "none";
export const SETUP_STEPS = 5;
/** A CNIC is never shown: every spoken CNIC is displayed as this fixed mask. */
export const MASKED_CNIC = "•••••-•••••••-•";
/** How long the app listens for each spoken answer. */
export const LISTEN_MS = 8000;
