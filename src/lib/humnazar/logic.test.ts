import { describe, expect, it } from "vitest";
import {
  acceptingVolunteer,
  acceptAtSecondsLeft,
  canWiden,
  makeRequestNumber,
  needsHuman,
  SAMPLE_ITEM_KIND,
} from "./logic";

describe("Humnazar sample rules", () => {
  it("a friend request is accepted by Bilal", () => {
    expect(acceptingVolunteer("friend")?.id).toBe("bilal");
  });

  it("a man or anyone request is accepted by Imran", () => {
    expect(acceptingVolunteer("man")?.id).toBe("imran");
    expect(acceptingVolunteer("anyone")?.id).toBe("imran");
  });

  it("a woman request always ends with no one accepting", () => {
    expect(acceptingVolunteer("woman")).toBeNull();
  });

  it("widen to anyone is only offered for woman or man", () => {
    expect(canWiden("woman")).toBe(true);
    expect(canWiden("man")).toBe(true);
    expect(canWiden("friend")).toBe(false);
    expect(canWiden("anyone")).toBe(false);
  });

  it("acceptance lands at about 4 of the 5 demo seconds", () => {
    expect(acceptAtSecondsLeft).toBe(12);
  });

  it("spice packet goes to AI; medicine strip and shirt style need a human", () => {
    expect(needsHuman(SAMPLE_ITEM_KIND.spice)).toBe(false);
    expect(needsHuman(SAMPLE_ITEM_KIND.medicine)).toBe(true);
    expect(needsHuman(SAMPLE_ITEM_KIND.shirt)).toBe(true);
  });

  it("request number is HNZ-MMDD-4 digits", () => {
    expect(makeRequestNumber(new Date(2026, 10, 15), () => 0.4827)).toBe("HNZ-1115-4827");
    expect(makeRequestNumber(new Date(2026, 0, 3), () => 0.0005)).toBe("HNZ-0103-0005");
  });
});

import { afterLanguage, afterLanguageFor, afterStart, LISTEN_MS, MASKED_CNIC, SETUP_STEPS } from "./logic";

describe("language is asked first", () => {
  it("a blind or low-vision user goes Home after choosing a language", () => {
    expect(afterLanguage("user")).toBe("B");
  });
  it("a volunteer goes to the WhatsApp message after choosing a language", () => {
    expect(afterLanguage("volunteer")).toBe("V1");
  });
  it("listens up to 8 seconds for a spoken answer", () => {
    expect(LISTEN_MS).toBe(8000);
  });
});

describe("sign-up", () => {
  it("log in opens Choose language for both roles", () => {
    expect(afterStart(false, "user")).toBe("L");
    expect(afterStart(false, "volunteer")).toBe("L");
  });
  it("sign up: a blind user goes to Choose language, a volunteer to 'coming next'", () => {
    expect(afterStart(true, "user")).toBe("L");
    expect(afterStart(true, "volunteer")).toBe("VS");
  });
  it("a CNIC is always shown as •••••-•••••••-• with no digits", () => {
    expect(MASKED_CNIC).toBe("•••••-•••••••-•");
    expect(MASKED_CNIC).not.toMatch(/\d/);
  });
});

describe("blind-user sign-up path", () => {
  it("after Choose language, sign-up goes to the terms and log in goes Home as before", () => {
    expect(afterLanguageFor("user", true)).toBe("S2");
    expect(afterLanguageFor("user", false)).toBe("B");
    expect(afterLanguageFor("volunteer", false)).toBe("V1");
  });
  it("the setup has 5 steps", () => {
    expect(SETUP_STEPS).toBe(5);
  });
});
