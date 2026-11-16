import assert from "node:assert/strict";
import test from "node:test";
import {
  chipLabel,
  assumedSkillCommand,
  fadeMask,
  isWheelNotch,
  pageScrollTarget,
  scrollEdges,
  stripWidth,
  wheelToScroll,
  composeDraft,
  composeWithSelection,
  isSelectionLive,
  keepComposerFocus,
  locateInDraft,
  normalizeSelectionText,
  isCollapsed,
  readStoredCollapsed,
  resolveCommandTarget,
  roomForChips,
  showToggle,
  targetKey,
  readStoredButtons,
  validateButtons,
  type SkillCommand,
} from "../lib/buttons.ts";

const command: SkillCommand = { name: "review", source: "skill", origin: "user", argumentHint: null };
const button = (n: number, patch: Record<string, unknown> = {}) => ({
  id: `b${n}`,
  skill: "review",
  emoji: "",
  label: `L${n}`,
  mode: "insert",
  args: "",
  ...patch,
});

test("validation accepts any number of buttons", () => {
  assert.equal(validateButtons([]).ok, true);
  for (const count of [1, 6, 7, 25, 100]) {
    const result = validateButtons(Array.from({ length: count }, (_, i) => button(i)));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.buttons.length, count);
  }
});

test("validation normalizes the skill name and args", () => {
  const result = validateButtons([button(1, { skill: "  /code-review ", args: " --fast \n now " })]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.buttons[0]?.skill, "code-review");
    assert.equal(result.buttons[0]?.args, "--fast now");
  }
});

test("validation rejects bad input with a button number", () => {
  for (const bad of [
    button(1, { skill: "  " }),
    button(1, { skill: "two words" }),
    button(1, { mode: "run" }),
    button(1, { label: "x".repeat(21) }),
    button(1, { args: "x".repeat(501) }),
    button(1, { id: "bad id" }),
  ]) {
    const result = validateButtons([bad]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /^Button 1: /);
  }
  assert.equal(validateButtons([button(1), button(1)]).ok, false);
  assert.equal(validateButtons("nope").ok, false);
});

test("stored data is read tolerantly, without a cap", () => {
  const stored = [button(1), { nonsense: true }, button(1), ...Array.from({ length: 9 }, (_, i) => button(i + 10))];
  const buttons = readStoredButtons(stored);
  assert.equal(buttons.length, 10);
  assert.equal(new Set(buttons.map((b) => b.id)).size, 10);
  assert.equal(readStoredButtons(Array.from({ length: 30 }, (_, i) => button(i))).length, 30);
  assert.deepEqual(readStoredButtons(undefined), []);
});

test("chip label falls back to the skill name", () => {
  assert.equal(chipLabel({ emoji: "🔍", label: "Review", skill: "review" }), "🔍 Review");
  assert.equal(chipLabel({ emoji: "🔍", label: "", skill: "review" }), "🔍");
  assert.equal(chipLabel({ emoji: "", label: "", skill: "review" }), "review");
});

test("insert into an empty draft: pill first, trailing space to keep typing", () => {
  const draft = composeDraft({ text: "", mentions: [] }, { args: "" }, command);
  assert.equal(draft.text, "/review ");
  assert.deepEqual(draft.mentions.map((m) => [m.kind, m.from, m.to, m.label]), [["command", 0, 7, "review"]]);
});

test("insert with args and existing text keeps the text after the args", () => {
  const draft = composeDraft({ text: "the login page", mentions: [] }, { args: "--deep" }, command);
  assert.equal(draft.text, "/review --deep the login page");
});

test("other mentions move with their text", () => {
  const mention = { from: 4, to: 9, label: "a.ts", kind: "path" };
  const draft = composeDraft({ text: "see @a.ts", mentions: [mention] }, { args: "" }, command);
  assert.equal(draft.text, "/review see @a.ts");
  const moved = draft.mentions[1];
  assert.equal(draft.text.slice(moved?.from, moved?.to), "@a.ts");
  assert.equal(moved?.from, 12);
});

test("an existing leading command pill is replaced, not duplicated", () => {
  const leading = { from: 0, to: 5, label: "plan", kind: "command" };
  const draft = composeDraft({ text: "/plan do it", mentions: [leading] }, { args: "" }, command);
  assert.equal(draft.text, "/review do it");
  assert.equal(draft.mentions.length, 1);
  assert.equal(draft.mentions[0]?.label, "review");
});

test("send into an empty draft submits the skill alone, without trailing space", () => {
  const draft = composeDraft({ text: "  ", mentions: [] }, { args: "" }, command, { trimEnd: true });
  assert.equal(draft.text, "/review");
  const withArgs = composeDraft({ text: "", mentions: [] }, { args: "a b" }, command, { trimEnd: true });
  assert.equal(withArgs.text, "/review a b");
});

test("send with draft text prepends the pill and args as one message", () => {
  const draft = composeDraft({ text: "fix the bug", mentions: [] }, { args: "--x" }, command, { trimEnd: true });
  assert.equal(draft.text, "/review --x fix the bug");
});

test("toggle is shown only with more than one button", () => {
  assert.equal(showToggle(0), false);
  assert.equal(showToggle(1), false);
  assert.equal(showToggle(2), true);
  assert.equal(showToggle(30), true);
});

test("collapse state defaults to expanded when nothing usable is stored", () => {
  assert.equal(readStoredCollapsed(undefined), false);
  assert.equal(readStoredCollapsed(null), false);
  assert.equal(readStoredCollapsed("true"), false);
  assert.equal(readStoredCollapsed({}), false);
  assert.equal(readStoredCollapsed(false), false);
  assert.equal(readStoredCollapsed(true), true);
});

test("stored collapse only applies while the toggle exists", () => {
  assert.equal(isCollapsed(3, true), true);
  assert.equal(isCollapsed(3, false), false);
  assert.equal(isCollapsed(2, true), true);
  assert.equal(isCollapsed(1, true), false);
  assert.equal(isCollapsed(0, true), false);
});

test("the toggle's width is reserved before the strip is sized", () => {
  assert.equal(roomForChips(200, false, 4, 24), 200);
  assert.equal(roomForChips(200, true, 4, 24), 172);
  assert.equal(roomForChips(10, true, 4, 24), 0);
});

test("the strip is as wide as its chips when they fit, else the room", () => {
  assert.equal(stripWidth(150, 400), 150);
  assert.equal(stripWidth(500, 172), 172);
  assert.equal(stripWidth(500, 172.9), 172);
  assert.equal(stripWidth(500, 0), 0);
  assert.equal(stripWidth(500, -5), 0);
  assert.equal(stripWidth(500, null), null);
});

test("scroll edges show only where content is clipped", () => {
  assert.deepEqual(scrollEdges(0, 200, 200), { left: false, right: false });
  assert.deepEqual(scrollEdges(0, 200, 500), { left: false, right: true });
  assert.deepEqual(scrollEdges(150, 200, 500), { left: true, right: true });
  assert.deepEqual(scrollEdges(300, 200, 500), { left: true, right: false });
  // sub-pixel rounding does not invent an edge
  assert.deepEqual(scrollEdges(0.4, 200, 200.8), { left: false, right: false });
});

test("an arrow click scrolls about one strip width and stays in range", () => {
  assert.equal(pageScrollTarget(0, 200, 1000, 1), 160);
  assert.equal(pageScrollTarget(160, 200, 1000, 1), 320);
  assert.equal(pageScrollTarget(700, 200, 1000, 1), 800);
  assert.equal(pageScrollTarget(100, 200, 1000, -1), 0);
  assert.equal(pageScrollTarget(500, 200, 1000, -1), 340);
  assert.equal(pageScrollTarget(0, 200, 100, 1), 0);
});

test("a vertical wheel maps to horizontal scroll; a horizontal one is left alone", () => {
  assert.equal(wheelToScroll(0, 100, 0), 100);
  assert.equal(wheelToScroll(0, -3, 1), -48);
  assert.equal(wheelToScroll(40, 10, 0), 0);
  assert.equal(wheelToScroll(10, 10, 0), 0);
  assert.equal(isWheelNotch(100), true);
  assert.equal(isWheelNotch(-120), true);
  assert.equal(isWheelNotch(4), false);
});

test("the fade covers only the clipped edges", () => {
  assert.equal(fadeMask({ left: false, right: false }), undefined);
  assert.match(fadeMask({ left: true, right: false }) ?? "", /transparent 0, #000 24px, #000 100%/);
  assert.match(fadeMask({ left: false, right: true }) ?? "", /#000 0, #000 0, #000 calc\(100% - 24px\), transparent 100%/);
  assert.match(fadeMask({ left: true, right: true }, 10) ?? "", /transparent 0, #000 10px, #000 calc\(100% - 10px\), transparent 100%/);
});

test("a thread composer targets its thread", () => {
  assert.deepEqual(resolveCommandTarget({ kind: "thread", threadId: "thr_1" }, null), { kind: "thread", threadId: "thr_1" });
  assert.equal(resolveCommandTarget({ kind: "thread" }, null), null);
});

test("a queued-message editor has no target", () => {
  assert.equal(resolveCommandTarget({ kind: "queued-message", threadId: "thr_1" }, { projectId: "p", providerId: "x" }), null);
});

test("a new-thread composer targets its selected project, provider and environment", () => {
  const scope = { kind: "new-thread" };
  assert.equal(resolveCommandTarget(scope, null), null);
  assert.equal(resolveCommandTarget(scope, { projectId: "p1" }), null);
  assert.deepEqual(resolveCommandTarget(scope, { projectId: "p1", providerId: "claude-code" }), {
    kind: "new-thread",
    projectId: "p1",
    providerId: "claude-code",
    environmentId: null,
    hostId: null,
  });
  assert.deepEqual(
    resolveCommandTarget(scope, { projectId: "p1", providerId: "codex", environment: { type: "reuse", environmentId: "env_1" } }),
    { kind: "new-thread", projectId: "p1", providerId: "codex", environmentId: "env_1", hostId: null },
  );
  assert.deepEqual(
    resolveCommandTarget(scope, { projectId: "p1", providerId: "codex", environment: { type: "host", hostId: "host_1" } }),
    { kind: "new-thread", projectId: "p1", providerId: "codex", environmentId: null, hostId: "host_1" },
  );
});

test("the target key changes with provider, project or environment, and only then", () => {
  const scope = { kind: "new-thread" };
  const a = resolveCommandTarget(scope, { projectId: "p1", providerId: "claude-code" });
  const same = resolveCommandTarget(scope, { projectId: "p1", providerId: "claude-code" });
  assert.equal(targetKey(a), targetKey(same));
  assert.notEqual(targetKey(a), targetKey(resolveCommandTarget(scope, { projectId: "p1", providerId: "codex" })));
  assert.notEqual(targetKey(a), targetKey(resolveCommandTarget(scope, { projectId: "p2", providerId: "claude-code" })));
  assert.equal(targetKey(null), "none");
});

test("an assumed command is a user skill with no argument hint", () => {
  assert.deepEqual(assumedSkillCommand("review"), { name: "review", source: "skill", origin: "user", argumentHint: null });
});

const rangeOf = (draft: { text: string; mentions: Array<{ from: number; to: number }> }, index: number) =>
  draft.text.slice(draft.mentions[index]?.from, draft.mentions[index]?.to);

test("selection text keeps line breaks and drops edge whitespace", () => {
  assert.equal(normalizeSelectionText("  a\r\nb \n"), "a\nb");
  assert.equal(normalizeSelectionText(" \n\t "), "");
});

test("outside selection into an empty draft: pill, args, selected text", () => {
  const draft = composeWithSelection({ text: "", mentions: [] }, { args: "" }, command, { kind: "outside", text: " some passage \n" });
  assert.equal(draft.text, "/review some passage");
  assert.deepEqual(draft.mentions.map((m) => [m.kind, m.from, m.to]), [["command", 0, 7]]);
  const withArgs = composeWithSelection({ text: "", mentions: [] }, { args: "--deep" }, command, { kind: "outside", text: "x" });
  assert.equal(withArgs.text, "/review --deep x");
});

test("outside selection keeps line breaks and is followed by the existing draft", () => {
  const draft = composeWithSelection({ text: "why?", mentions: [] }, { args: "" }, command, { kind: "outside", text: "line one\nline two" });
  assert.equal(draft.text, "/review line one\nline two\nwhy?");
  const single = composeWithSelection({ text: "why?", mentions: [] }, { args: "" }, command, { kind: "outside", text: "one line" });
  assert.equal(single.text, "/review one line why?");
});

test("outside selection moves the draft's own pills and replaces a leading command pill", () => {
  const mention = { from: 4, to: 9, label: "a.ts", kind: "path" };
  const draft = composeWithSelection({ text: "see @a.ts", mentions: [mention] }, { args: "" }, command, { kind: "outside", text: "quote" });
  assert.equal(draft.text, "/review quote see @a.ts");
  assert.equal(draft.text.slice(draft.mentions[1]?.from, draft.mentions[1]?.to), "@a.ts");
  const leading = { from: 0, to: 5, label: "plan", kind: "command" };
  const replaced = composeWithSelection({ text: "/plan go", mentions: [leading] }, { args: "" }, command, { kind: "outside", text: "q" });
  assert.equal(replaced.text, "/review q go");
  assert.equal(replaced.mentions.length, 1);
});

test("whitespace-only or missing selection behaves as before", () => {
  const base = composeDraft({ text: "hi", mentions: [] }, { args: "a" }, command);
  assert.deepEqual(composeWithSelection({ text: "hi", mentions: [] }, { args: "a" }, command, null), base);
  assert.deepEqual(composeWithSelection({ text: "hi", mentions: [] }, { args: "a" }, command, { kind: "outside", text: " \n " }), base);
  assert.deepEqual(composeWithSelection({ text: "hi", mentions: [] }, { args: "a" }, command, { kind: "composer", text: "  ", before: "" }), base);
});

test("composer selection: the pill goes right before the selected range", () => {
  const text = "fix the login page now";
  const start = composeWithSelection({ text, mentions: [] }, { args: "" }, command, { kind: "composer", text: "fix the", before: "" });
  assert.equal(start.text, "/review fix the login page now");
  const middle = composeWithSelection({ text, mentions: [] }, { args: "" }, command, { kind: "composer", text: "login page", before: "fix the " });
  assert.equal(middle.text, "fix the /review login page now");
  assert.equal(rangeOf(middle, 0), "/review");
  const end = composeWithSelection({ text, mentions: [] }, { args: "--x" }, command, { kind: "composer", text: "now", before: "fix the login page " });
  assert.equal(end.text, "fix the login page /review --x now");
});

test("composer selection keeps other pills attached to their text", () => {
  const text = "see @a.ts and @b.ts today";
  const a = { from: 4, to: 9, label: "a.ts", kind: "path" };
  const b = { from: 14, to: 19, label: "b.ts", kind: "path" };
  const draft = composeWithSelection({ text, mentions: [a, b] }, { args: "" }, command, { kind: "composer", text: "and", before: "see @a.ts " });
  assert.equal(draft.text, "see @a.ts /review and @b.ts today");
  assert.deepEqual(draft.mentions.map((m) => draft.text.slice(m.from, m.to)), ["@a.ts", "/review", "@b.ts"]);
});

test("a selection starting inside a pill puts the new pill before that pill", () => {
  const text = "see @a.ts now";
  const a = { from: 4, to: 9, label: "a.ts", kind: "path" };
  const draft = composeWithSelection({ text, mentions: [a] }, { args: "" }, command, { kind: "composer", text: "a.ts now", before: "see @" });
  assert.equal(draft.text, "see /review @a.ts now");
  assert.deepEqual(draft.mentions.map((m) => draft.text.slice(m.from, m.to)), ["/review", "@a.ts"]);
});

test("repeated text is told apart by what precedes the selection", () => {
  const text = "go go go";
  assert.deepEqual(locateInDraft(text, "go", ""), { from: 0, to: 2 });
  assert.deepEqual(locateInDraft(text, "go", "go "), { from: 3, to: 5 });
  assert.deepEqual(locateInDraft(text, "go", "go go "), { from: 6, to: 8 });
  assert.equal(locateInDraft(text, "stop", ""), null);
  assert.equal(locateInDraft(text, "  ", ""), null);
  // paragraph separators may differ between the editor and the draft
  assert.deepEqual(locateInDraft("a\nb", "a\n\nb", ""), { from: 0, to: 3 });
});

test("a composer selection that cannot be found falls back to the plain behavior", () => {
  const base = composeDraft({ text: "hello", mentions: [] }, { args: "" }, command);
  assert.deepEqual(
    composeWithSelection({ text: "hello", mentions: [] }, { args: "" }, command, { kind: "composer", text: "gone", before: "" }),
    base,
  );
});

test("a captured selection is live only while the draft still holds it", () => {
  assert.equal(isSelectionLive(null, "x"), false);
  assert.equal(isSelectionLive({ kind: "outside", text: "x" }, ""), true);
  assert.equal(isSelectionLive({ kind: "outside", text: " " }, "x"), false);
  assert.equal(isSelectionLive({ kind: "composer", text: "login", before: "fix the " }, "fix the login"), true);
  assert.equal(isSelectionLive({ kind: "composer", text: "login", before: "fix the " }, "fix the signup"), false);
});

test("pressing our buttons keeps focus in the composer (iOS taps would otherwise fold it)", () => {
  let prevented = 0;
  keepComposerFocus({ preventDefault: () => (prevented += 1) });
  assert.equal(prevented, 1);
});

test("every button the strip renders holds the composer's focus", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
  const starts = [...source.matchAll(/<button\b/g)].map((match) => match.index ?? 0);
  assert.equal(starts.length, 5, "show chip, skill chips, both arrows, hide toggle");
  for (const start of starts) {
    const opening = source.slice(start, source.indexOf("\n      >", start) > 0 ? Math.min(source.indexOf("\n      >", start), start + 900) : start + 900);
    assert.match(opening, /onMouseDown=\{keepComposerFocus\}/, opening.slice(0, 80));
  }
});
