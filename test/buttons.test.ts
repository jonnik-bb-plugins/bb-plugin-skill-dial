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
