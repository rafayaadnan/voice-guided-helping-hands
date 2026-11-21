import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Prototype } from "@/components/humnazar/Prototype";

// Scripted voice layer: nothing is really spoken or heard. The test says what the person says.
const spoken: string[] = [];
let urduVoice = false;
let latest: ((r: unknown) => void) | null = null;

vi.mock("@/lib/humnazar/speech", async (orig) => {
  const real = await orig<typeof import("@/lib/humnazar/speech")>();
  return {
    ...real,
    recognitionSupported: () => true,
    hasUrduVoice: () => urduVoice,
    speak: vi.fn(async (text: string) => { spoken.push(text); return true; }),
    listen: vi.fn(() => new Promise((res) => { latest = res; })),
  };
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function utter(text: string) {
  await flush();
  await waitFor(() => { if (!latest) throw new Error("not listening"); });
  const r = latest!;
  latest = null;
  await act(async () => { r({ status: "ok", text, alternatives: [text] }); });
  await flush();
}
const lastSpoken = () => spoken[spoken.length - 1] ?? "";
const title = () => document.querySelector("[data-screen-title]")?.textContent;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => { spoken.length = 0; latest = null; urduVoice = false; vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Welcome", () => {
  it("shows the name, one line and two buttons, with no Reads aloud box", () => {
    render(<Prototype />);
    expect(title()).toBe("Humnazar");
    expect(screen.getByText("Voice-first help from volunteers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.queryByText(/Reads aloud/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("Log in opens the existing Start screen unchanged", () => {
    render(<Prototype />);
    click("Log in");
    expect(title()).toBe("Start: choose view (prototype only)");
    expect(screen.getByRole("button", { name: "I am a volunteer" })).toBeInTheDocument();
  });

  it("Sign up opens Start with the heading 'Sign up as'; volunteer shows 'coming next' with Back", () => {
    render(<Prototype />);
    click("Sign up");
    expect(title()).toBe("Sign up as");
    click("I am a volunteer");
    expect(title()).toBe("Volunteer sign-up");
    expect(screen.getAllByText("Volunteer sign-up coming next").length).toBeGreaterThan(0);
    const backs = screen.getAllByRole("button", { name: "Back" });
    fireEvent.click(backs[backs.length - 1]!);
    expect(title()).toBe("Sign up as");
  });

  it("log in as a volunteer still goes Choose language then the WhatsApp message", async () => {
    render(<Prototype />);
    click("Log in");
    click("I am a volunteer");
    expect(title()).toBe("Choose language");
    expect(screen.queryByText(/Step 1 of 5/)).toBeNull();
  });
});

describe("Blind-user sign-up, spoken end to end", () => {
  it("runs the five steps in English and ends on Home", async () => {
    render(<Prototype />);
    click("Sign up");
    click("I am a blind or low-vision user");

    // 1 Language (the existing screen, with the step line)
    expect(title()).toBe("Choose language");
    expect(screen.getAllByText("Step 1 of 5").length).toBeGreaterThan(0);
    await waitFor(() => expect(spoken.some((s) => s.startsWith("Step 1 of 5. Choose your language."))).toBe(true));
    await utter("English");
    await waitFor(() => expect(lastSpoken()).toContain("English selected. Say confirm"));
    await utter("confirm");

    // 2 Terms: accept moves on with no extra confirm; "read again" repeats
    await waitFor(() => expect(title()).toBe("Terms and disclaimer"));
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["What volunteers do", "Emergencies", "Privacy"]);
    await waitFor(() => expect(lastSpoken()).toContain("Say 'I accept' to continue, or 'read again'."));
    expect(lastSpoken()).toContain("Step 2 of 5. Humnazar connects you with volunteers who describe what they see. They describe; they do not decide for you. Do not use Humnazar in an emergency. Your calls are not recorded.");
    const before = spoken.length;
    await utter("read again");
    await waitFor(() => expect(spoken.length).toBeGreaterThan(before));
    await utter("I accept");

    // 3 Verification: association, then CNIC (masked everywhere), then continue with a confirm
    await waitFor(() => expect(title()).toBe("Verification"));
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
    await waitFor(() => expect(lastSpoken()).toContain("Say the name of your association. Then say your CNIC number. Your CNIC is never shown to volunteers."));
    await utter("Pakistan Association of the Blind");
    await waitFor(() => expect(lastSpoken()).toBe("Say your CNIC number. Say back to go back."));
    expect(spoken).toContain("Association: Pakistan Association of the Blind.");
    expect(screen.getByText("Association: Pakistan Association of the Blind (sample)")).toBeInTheDocument();
    await utter("35202 1234567 1");
    await waitFor(() => expect(screen.getByText("Verification submitted (sample). The association will confirm.")).toBeInTheDocument());
    expect(screen.getByText("•••••-•••••••-•")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/35202|1234567/);
    expect(spoken.join(" | ")).not.toMatch(/35202|1234567/);
    await waitFor(() => expect(lastSpoken()).toContain("Say continue."));
    await utter("continue");
    await waitFor(() => expect(lastSpoken()).toContain("Say confirm to go to the next step"));
    await utter("confirm");

    // 4 Gender: "prefer not to say" speaks and shows the matching note
    await waitFor(() => expect(title()).toBe("Gender"));
    expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
    await utter("prefer not to say");
    await waitFor(() => expect(lastSpoken()).toContain("You can still use Humnazar. You will only be matched with volunteers who help anyone."));
    expect(screen.getAllByText("You can still use Humnazar. You will only be matched with volunteers who help anyone.").length).toBeGreaterThan(0);
    await utter("confirm");

    // 5 All set, then Home
    await waitFor(() => expect(title()).toBe("All set"));
    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.getByText(/Setup complete\. Humnazar works with TalkBack and VoiceOver.*2 GB of RAM\. Say continue to start\./)).toBeInTheDocument();
    await waitFor(() => expect(lastSpoken()).toContain("Say continue to start."));
    await utter("continue");
    await waitFor(() => expect(lastSpoken()).toContain("Say confirm to go to Home"));
    await utter("confirm");
    await waitFor(() => expect(title()).toBe("Home"));
  });

  it("'back' goes to the previous screen, and the CNIC is masked even in the heard-text line", async () => {
    render(<Prototype />);
    click("Sign up");
    click("I am a blind or low-vision user");
    await utter("English");
    await utter("confirm");
    await waitFor(() => expect(title()).toBe("Terms and disclaimer"));
    await utter("back");
    await waitFor(() => expect(title()).toBe("Choose language"));
    await utter("English");
    await utter("confirm");
    await waitFor(() => expect(title()).toBe("Terms and disclaimer"));
    await utter("accept");
    await waitFor(() => expect(title()).toBe("Verification"));
    await utter("Blind Association");
    await waitFor(() => expect(lastSpoken()).toContain("Say your CNIC number."));
    await utter("35202-1234567-1");
    await waitFor(() => expect(screen.getByText("•••••-•••••••-•")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/35202|1234567/);
  });

  it("Urdu is chosen in step 1 and every later step is shown and spoken in Urdu", async () => {
    urduVoice = true;
    render(<Prototype />);
    click("Sign up");
    click("I am a blind or low-vision user");
    await waitFor(() => expect(spoken.some((s) => s.startsWith("مرحلہ 1 از 5۔"))).toBe(true));
    await utter("اردو");
    await waitFor(() => expect(lastSpoken()).toContain("اردو منتخب ہو گئی"));
    await utter("تصدیق");
    await waitFor(() => expect(title()).toBe("شرائط اور دستبرداری"));
    expect(screen.getByText("مرحلہ 2 از 5")).toBeInTheDocument();
    await waitFor(() => expect(lastSpoken()).toContain('آگے بڑھنے کے لیے "قبول ہے" کہیں، یا "دوبارہ" کہیں۔'));
    await utter("قبول ہے");
    await waitFor(() => expect(title()).toBe("شناخت کی تصدیق"));
    await utter("انجمن");
    await utter("کچھ بھی");
    await utter("جاری رکھیں");
    await utter("تصدیق");
    await waitFor(() => expect(title()).toBe("جنس"));
    await utter("خاتون");
    await utter("تصدیق");
    await waitFor(() => expect(title()).toBe("سب تیار ہے"));
    await utter("جاری رکھیں");
    await utter("تصدیق");
    await waitFor(() => expect(title()).toBe("ہوم"));
  });
});
