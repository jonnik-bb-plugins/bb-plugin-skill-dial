// Pure logic shared by the server, the composer chips and the settings section:
// the button schema (including the 6-button cap), draft composition for the
// `insert` and `send` modes, and the chip/overflow split.
import { z } from "zod";

export const MAX_LABEL = 20;
export const MAX_EMOJI = 8;
export const MAX_ARGS = 500;

export type ButtonMode = "insert" | "send";

/** A skill name as bb's `/` menu shows it: no trigger character, no whitespace. */
export function normalizeSkill(input: string): string {
  return input.trim().replace(/^[/$]+/, "");
}

export const skillNameSchema = z
  .string()
  .transform(normalizeSkill)
  .pipe(
    z
      .string()
      .min(1, "Pick a skill")
      .max(100, "Skill name is too long")
      .refine((name) => !/\s/.test(name), "Skill name cannot contain spaces"),
  );

export const buttonSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    skill: skillNameSchema,
    emoji: z.string().trim().max(MAX_EMOJI, `Emoji: at most ${MAX_EMOJI} characters`).default(""),
    label: z.string().trim().max(MAX_LABEL, `Label: at most ${MAX_LABEL} characters`).default(""),
    mode: z.enum(["insert", "send"]),
    args: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().max(MAX_ARGS, `Args: at most ${MAX_ARGS} characters`))
      .default(""),
  })
  .strict();

export type SkillButton = z.infer<typeof buttonSchema>;

export const buttonsSchema = z
  .array(buttonSchema)
  .refine((buttons) => new Set(buttons.map((button) => button.id)).size === buttons.length, "Duplicate button id");

export type ValidationResult = { ok: true; buttons: SkillButton[] } | { ok: false; error: string };

/** Validate and normalize a whole button list; the error is safe to show as is. */
export function validateButtons(input: unknown): ValidationResult {
  const parsed = buttonsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[0] === "number" ? `Button ${issue.path[0] + 1}: ` : "";
    return { ok: false, error: `${index}${issue?.message ?? "Invalid buttons"}` };
  }
  return { ok: true, buttons: parsed.data };
}

/** A tolerant read of persisted data: invalid and duplicate entries are dropped; any number of buttons loads. */
export function readStoredButtons(value: unknown): SkillButton[] {
  if (!Array.isArray(value)) return [];
  const buttons: SkillButton[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const parsed = buttonSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    buttons.push(parsed.data);
  }
  return buttons;
}

/** What a chip shows: emoji and label, falling back to the skill name. */
export function chipLabel(button: Pick<SkillButton, "emoji" | "label" | "skill">): string {
  const text = [button.emoji, button.label].filter((part) => part !== "").join(" ");
  return text === "" ? button.skill : text;
}

export interface SkillCommand {
  name: string;
  source: "command" | "skill";
  origin: "builtin" | "project" | "user";
  argumentHint: string | null;
}

export interface DraftMention {
  from: number;
  to: number;
  label: string;
  kind: string;
  [key: string]: unknown;
}

export interface DraftLike<M extends DraftMention = DraftMention> {
  text: string;
  mentions: readonly M[];
}

/**
 * The draft with the skill pill (`/name`) and the button's args at the start,
 * and the existing text after them. A command pill already at the start is
 * replaced, as bb's own Plan and Goal rows do. Other pills move with their text.
 * With `trimEnd`, nothing trails the message when the draft was empty (`send`).
 */
export function composeDraft<M extends DraftMention>(
  draft: DraftLike<M>,
  button: Pick<SkillButton, "args">,
  command: SkillCommand,
  options: { trimEnd?: boolean } = {},
): { text: string; mentions: Array<M | DraftMention> } {
  const leading = draft.mentions.find((mention) => mention.kind === "command" && mention.from === 0);
  const rest = draft.text.slice(leading?.to ?? 0).trimStart();
  const pillText = `/${command.name}`;
  const prefix = button.args === "" ? `${pillText} ` : `${pillText} ${button.args} `;
  const shift = prefix.length - (draft.text.length - rest.length);
  const others = draft.mentions
    .filter((mention) => mention !== leading)
    .map((mention) => ({ ...mention, from: mention.from + shift, to: mention.to + shift }));
  const text = options.trimEnd === true && rest === "" ? prefix.trimEnd() : `${prefix}${rest}`;
  const pill: DraftMention = {
    kind: "command",
    trigger: "/",
    from: 0,
    to: pillText.length,
    label: command.name,
    name: command.name,
    source: command.source,
    origin: command.origin,
    argumentHint: command.argumentHint,
  };
  return { text, mentions: [pill, ...others] };
}

export function newButtonId(existing: readonly string[], random: () => string): string {
  for (;;) {
    const id = random();
    if (!existing.includes(id)) return id;
  }
}

/** The collapse toggle is offered only when there is more than one button to hide. */
export function showToggle(buttonCount: number): boolean {
  return buttonCount > 1;
}

export const collapsedSchema = z.boolean();

/** Persisted collapse state; anything unreadable means expanded, the default. */
export function readStoredCollapsed(value: unknown): boolean {
  const parsed = collapsedSchema.safeParse(value);
  return parsed.success ? parsed.data : false;
}

/** Whether the chips are hidden: a stored "collapsed" only counts while the toggle exists. */
export function isCollapsed(buttonCount: number, stored: boolean): boolean {
  return showToggle(buttonCount) && stored;
}

/** Width left for the chip strip once the collapse toggle takes its share. */
export function roomForChips(available: number, hasToggle: boolean, gap: number, toggleWidth: number): number {
  return hasToggle ? Math.max(0, available - toggleWidth - gap) : available;
}

/** Where to ask for skills: a thread, or the provider/project a new-thread composer has selected. */
export type CommandTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "new-thread"; projectId: string; providerId: string; environmentId: string | null; hostId: string | null };

interface TargetScope {
  kind: string;
  threadId?: string;
}

interface TargetSelection {
  projectId?: string;
  providerId?: string;
  environment?: { type: string; environmentId?: string; hostId?: string };
}

/**
 * The target for a composer's skills, or null when it cannot be known yet (a
 * new-thread composer whose project or provider is not settled) or never
 * applies (queued-message editors).
 */
export function resolveCommandTarget(scope: TargetScope, selection: TargetSelection | null | undefined): CommandTarget | null {
  if (scope.kind === "thread") return scope.threadId === undefined ? null : { kind: "thread", threadId: scope.threadId };
  if (scope.kind !== "new-thread") return null;
  if (selection?.projectId === undefined || selection.providerId === undefined) return null;
  const environment = selection.environment;
  return {
    kind: "new-thread",
    projectId: selection.projectId,
    providerId: selection.providerId,
    environmentId: environment?.type === "reuse" ? (environment.environmentId ?? null) : null,
    hostId: environment?.type === "host" ? (environment.hostId ?? null) : null,
  };
}

/** A stable string for a target, so effects re-run exactly when provider/project/environment change. */
export function targetKey(target: CommandTarget | null): string {
  return target === null ? "none" : JSON.stringify(target);
}

/**
 * What a pill needs when the skill list is unknown (a new-thread composer whose
 * list could not be read): a user-level skill, as bb's `/` menu inserts for one.
 */
export function assumedSkillCommand(name: string): SkillCommand {
  return { name, source: "skill", origin: "user", argumentHint: null };
}

/**
 * The strip's width: as wide as its chips when they fit, else the room there is.
 * Null when the room is unknown (the strip then takes its natural width).
 */
export function stripWidth(natural: number, room: number | null): number | null {
  return room === null ? null : Math.max(0, Math.min(natural, Math.floor(room)));
}

/** Which edges of the strip have clipped content to scroll to. */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { left: boolean; right: boolean } {
  const slack = 1.5;
  return {
    left: scrollLeft > slack,
    right: scrollLeft + clientWidth < scrollWidth - slack,
  };
}

/**
 * Horizontal pixels a wheel event should scroll the strip by: a vertical wheel
 * or trackpad scroll maps to horizontal; an event that is already mostly
 * horizontal is left to the browser (0).
 */
export function wheelToScroll(deltaX: number, deltaY: number, deltaMode: number): number {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return 0;
  return deltaMode === 1 ? deltaY * 16 : deltaY;
}

/** A mouse-wheel notch (big, discrete step) scrolls smoothly; trackpad deltas are applied as they come. */
export function isWheelNotch(pixels: number): boolean {
  return Math.abs(pixels) >= 50;
}

/** A soft fade on the clipped edges, as a CSS mask so it needs no background color. */
export function fadeMask(edges: { left: boolean; right: boolean }, size = 24): string | undefined {
  if (!edges.left && !edges.right) return undefined;
  const start = edges.left ? `transparent 0, #000 ${size}px` : "#000 0, #000 0";
  const end = edges.right ? `#000 calc(100% - ${size}px), transparent 100%` : "#000 100%, #000 100%";
  return `linear-gradient(to right, ${start}, ${end})`;
}

/**
 * What the user had selected when a chip was used. `outside` is text selected
 * anywhere but the composer (the chat transcript, say). `composer` is a range
 * inside the composer's own editor: `text` is what is selected and `before` the
 * editor's plain text up to the selection's start (used to tell repeated
 * occurrences of `text` apart).
 */
export type SelectionInput = { kind: "outside"; text: string } | { kind: "composer"; text: string; before: string };

/** Selected text with line breaks kept as `\n` and the ends trimmed; "" when there is nothing to use. */
export function normalizeSelectionText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

function selectionPattern(selected: string): RegExp {
  const parts = selected.split(/\n+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(parts.join("\\n+"), "g");
}

function occurrences(haystack: string, selected: string): Array<{ index: number; length: number }> {
  const pattern = selectionPattern(selected);
  const found: Array<{ index: number; length: number }> = [];
  for (let match = pattern.exec(haystack); match !== null; match = pattern.exec(haystack)) {
    found.push({ index: match.index, length: match[0].length });
    pattern.lastIndex = match.index + 1;
  }
  return found;
}

/**
 * Where the selection sits in the draft text. The editor and the draft agree on
 * the text but not on pill labels or paragraph separators, so the selection is
 * found by its text: the k-th occurrence in the draft, k being how many
 * occurrences precede the selection in `before`. Null when it cannot be found
 * (a selection that includes a pill, say).
 */
export function locateInDraft(draftText: string, selected: string, before: string): { from: number; to: number } | null {
  const text = normalizeSelectionText(selected);
  if (text === "") return null;
  const inDraft = occurrences(draftText, text);
  if (inDraft.length === 0) return null;
  const preceding = occurrences(before, text).filter((hit) => hit.index + hit.length <= before.length).length;
  const hit = inDraft[Math.min(preceding, inDraft.length - 1)] as { index: number; length: number };
  return { from: hit.index, to: hit.index + hit.length };
}

/**
 * Like `composeDraft`, with the selection as the skill's parameter:
 * - outside the composer: pill + args + the selected text, then the draft;
 * - inside the composer: pill + args directly before the selected range, the
 *   rest of the draft where it was (pills before it keep their place, pills
 *   after it move with their text);
 * - nothing usable selected (or not found in the draft): exactly `composeDraft`.
 */
export function composeWithSelection<M extends DraftMention>(
  draft: DraftLike<M>,
  button: Pick<SkillButton, "args">,
  command: SkillCommand,
  selection: SelectionInput | null,
  options: { trimEnd?: boolean } = {},
): { text: string; mentions: Array<M | DraftMention> } {
  const selected = selection === null ? "" : normalizeSelectionText(selection.text);
  if (selection === null || selected === "") return composeDraft(draft, button, command, options);
  const pillText = `/${command.name}`;
  const prefix = button.args === "" ? `${pillText} ` : `${pillText} ${button.args} `;
  const pill: DraftMention = {
    kind: "command",
    trigger: "/",
    from: 0,
    to: pillText.length,
    label: command.name,
    name: command.name,
    source: command.source,
    origin: command.origin,
    argumentHint: command.argumentHint,
  };
  if (selection.kind === "outside") {
    const leading = draft.mentions.find((mention) => mention.kind === "command" && mention.from === 0);
    const rest = draft.text.slice(leading?.to ?? 0).trimStart();
    const head = `${prefix}${selected}`;
    const gap = rest === "" ? "" : selected.includes("\n") ? "\n" : " ";
    const shift = head.length + gap.length - (draft.text.length - rest.length);
    const others = draft.mentions
      .filter((mention) => mention !== leading)
      .map((mention) => ({ ...mention, from: mention.from + shift, to: mention.to + shift }));
    return { text: `${head}${gap}${rest}`, mentions: [pill, ...others] };
  }
  const located = locateInDraft(draft.text, selection.text, selection.before);
  if (located === null) return composeDraft(draft, button, command, options);
  // Never start a pill inside another: back up to the start of the mention the range begins in.
  const inside = draft.mentions.find((mention) => located.from > mention.from && located.from < mention.to);
  const at = inside === undefined ? located.from : inside.from;
  const moved = draft.mentions.map((mention) =>
    mention.from >= at ? { ...mention, from: mention.from + prefix.length, to: mention.to + prefix.length } : mention,
  );
  const placed: DraftMention = { ...pill, from: at, to: at + pillText.length };
  return {
    text: `${draft.text.slice(0, at)}${prefix}${draft.text.slice(at)}`,
    mentions: [...moved, placed].sort((a, b) => a.from - b.from),
  };
}

/** A captured selection is still usable only while the draft still holds its text where it was. */
export function isSelectionLive(selection: SelectionInput | null, draftText: string): boolean {
  if (selection === null || normalizeSelectionText(selection.text) === "") return false;
  return selection.kind === "outside" || locateInDraft(draftText, selection.text, selection.before) !== null;
}

/**
 * Pressing one of our buttons must not take focus from the composer's editor.
 * On iOS a tapped button is never focused, so the editor would blur, bb's
 * phone layout would fold the composer to its one-line form, and the chips
 * (not rendered there) would vanish before the tap's click acts. Use as
 * `onMouseDown` on every button we render inside the composer.
 */
export function keepComposerFocus(event: { preventDefault(): void }): void {
  event.preventDefault();
}

/** Below this composer width (px) chips show only their emoji. */
export const COMPACT_COMPOSER_MAX_WIDTH = 560;
const COMPACT_TEXT_LIMIT = 6;

/** Whether the composer is narrow enough for emoji-only chips; false when its width is unknown. */
export function isCompactComposer(width: number | null): boolean {
  return width !== null && width > 0 && width < COMPACT_COMPOSER_MAX_WIDTH;
}

function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : `${characters.slice(0, limit).join("").trimEnd()}…`;
}

/** What a compact chip shows: its emoji, else its label (or the skill name) cut to a few characters. */
export function compactChipText(button: Pick<SkillButton, "emoji" | "label" | "skill">): string {
  if (button.emoji !== "") return button.emoji;
  return truncate(button.label !== "" ? button.label : button.skill, COMPACT_TEXT_LIMIT);
}

/** The accessible name of a chip: `/skill`, plus the label when the chip does not show it. */
export function chipAccessibleName(button: Pick<SkillButton, "label" | "skill">, compact: boolean): string {
  return compact && button.label !== "" ? `/${button.skill} (${button.label})` : `/${button.skill}`;
}

/** The tooltip of a chip: what it does; in compact mode led by the label it does not show. */
export function chipTooltip(button: Pick<SkillButton, "label" | "skill" | "mode" | "args">, compact: boolean): string {
  const action = `${button.mode === "send" ? "Send" : "Insert"} /${button.skill}${button.args === "" ? "" : ` ${button.args}`}`;
  return compact && button.label !== "" ? `${button.label} — ${action}` : action;
}
