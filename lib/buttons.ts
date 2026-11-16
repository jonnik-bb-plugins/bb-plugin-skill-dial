// Pure logic shared by the server, the composer chips and the settings section:
// the button schema (including the 6-button cap), draft composition for the
// `insert` and `send` modes, and the chip/overflow split.
import { z } from "zod";

export const MAX_BUTTONS = 6;
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
  .max(MAX_BUTTONS, `At most ${MAX_BUTTONS} buttons`)
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

export function canAddButton(count: number): boolean {
  return count < MAX_BUTTONS;
}

/** A tolerant read of persisted data: invalid entries are dropped, the cap is kept. */
export function readStoredButtons(value: unknown): SkillButton[] {
  if (!Array.isArray(value)) return [];
  const buttons: SkillButton[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const parsed = buttonSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    buttons.push(parsed.data);
    if (buttons.length === MAX_BUTTONS) break;
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

/**
 * How many chips show before the overflow menu. `widths` are the chips'
 * natural widths; the overflow trigger takes `overflowWidth` plus a gap when
 * some chips are hidden. Never hides a chip that would have fit with nothing hidden.
 */
export function visibleChipCount(widths: readonly number[], available: number, gap: number, overflowWidth: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return widths.length;
  let used = overflowWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + gap + width;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
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

/** Width left for chips (and the "⋯" trigger) once the chevron toggle takes its share. */
export function roomForChips(available: number, hasToggle: boolean, gap: number, toggleWidth: number): number {
  return hasToggle ? Math.max(0, available - toggleWidth - gap) : available;
}
