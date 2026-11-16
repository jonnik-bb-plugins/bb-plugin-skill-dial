// bb-plugin-skill-buttons — frontend. Compact skill chips in the thread
// composer's action row (with a "⋯" overflow menu) and a settings section
// where the buttons are configured.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useComposer,
  useRealtime,
  useRpc,
  type ComposerMention,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import {
  canAddButton,
  chipLabel,
  assumedSkillCommand,
  composeDraft,
  isCollapsed,
  MAX_ARGS,
  MAX_BUTTONS,
  MAX_EMOJI,
  MAX_LABEL,
  newButtonId,
  resolveCommandTarget,
  roomForChips,
  showToggle,
  targetKey,
  validateButtons,
  visibleChipCount,
  type ButtonMode,
  type CommandTarget,
  type SkillButton,
  type SkillCommand,
} from "./lib/buttons.ts";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type CommandInfo = SkillCommand & { description: string | null };

const CHIP_GAP = 4;
const OVERFLOW_WIDTH = 28;
const TOGGLE_WIDTH = 24;

/** The saved buttons and collapse state, kept current by the server's "buttons-changed" signal. */
function useButtons() {
  const rpc = useRpc<typeof rpcContract>();
  const [buttons, setButtons] = useState<SkillButton[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const refetch = useCallback(() => {
    rpc.call("getButtons", null).then(
      (result) => {
        setButtons(result.buttons);
        setCollapsed(result.collapsed);
      },
      () => undefined,
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("buttons-changed", refetch);
  // Optimistic: flip at once, persist on the server, put it back if that fails.
  const setCollapsedOptimistic = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      rpc.call("setCollapsed", { collapsed: next }).then(
        () => undefined,
        (cause) => {
          setCollapsed(!next);
          toast.error(cause instanceof Error ? cause.message : "Could not save the skill buttons state");
        },
      );
    },
    [rpc],
  );
  return { rpc, buttons, setButtons, refetch, collapsed, setCollapsed: setCollapsedOptimistic };
}

type CommandsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  // New-thread composer whose skill list could not be read: availability is unknown, chips stay enabled.
  | { status: "unknown" }
  | { status: "ready"; byName: Map<string, CommandInfo> };

type ListTarget = CommandTarget | { kind: "latest" };

/**
 * What bb's `/` menu offers for `target`, asked again when the provider,
 * project or environment of a new-thread composer changes. A null target (not
 * settled yet) is unknown; so is a new-thread list that cannot be read.
 */
function useCommands(rpc: Rpc, target: ListTarget | null): CommandsState {
  const [state, setState] = useState<CommandsState>(target === null ? { status: "unknown" } : { status: "loading" });
  const key = target === null ? "none" : target.kind === "latest" ? "latest" : targetKey(target);
  useEffect(() => {
    if (target === null) {
      setState({ status: "unknown" });
      return;
    }
    let cancelled = false;
    const fail = (message: string): CommandsState =>
      target.kind === "new-thread" ? { status: "unknown" } : { status: "error", message };
    setState({ status: "loading" });
    rpc.call("listCommands", { target }).then(
      (result) => {
        if (cancelled) return;
        if (result.error !== null) setState(fail(result.error));
        else setState({ status: "ready", byName: new Map(result.commands.map((command) => [command.name, command])) });
      },
      (cause) => {
        if (!cancelled) setState(fail(cause instanceof Error ? cause.message : String(cause)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, key]);
  return state;
}

/** Why a button cannot run now, or null when it can. */
function disabledReason(button: SkillButton, commands: CommandsState, busy: boolean): string | null {
  if (busy) return "The composer is busy";
  if (commands.status === "loading") return "Loading skills…";
  if (commands.status === "unknown") return null;
  if (commands.status === "error") return `Skills unavailable: ${commands.message}`;
  if (!commands.byName.has(button.skill)) return `Skill "${button.skill}" is not available for this thread's provider`;
  return null;
}


/** Skip the `display: contents` wrappers bb puts around slots. */
function layoutParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent !== null && getComputedStyle(parent).display === "contents") parent = parent.parentElement;
  return parent;
}

/** The nearest wrapping flex row above `from` (excluding `from`), or null. */
function wrappingRowAbove(from: HTMLElement): HTMLElement | null {
  let element = layoutParent(from);
  for (let depth = 0; element !== null && depth < 6; depth += 1) {
    const style = getComputedStyle(element);
    if (style.display === "flex" && style.flexWrap === "wrap") return element;
    element = layoutParent(element);
  }
  return null;
}

/** The element that is a child of `row`, looking through `display: contents`, holding `descendant`. */
function childOf(row: HTMLElement, descendant: HTMLElement): HTMLElement | null {
  let element: HTMLElement | null = descendant;
  while (element !== null && layoutParent(element) !== row) element = layoutParent(element);
  return element;
}

function layoutChildren(row: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(row.children) as HTMLElement[]) {
    if (getComputedStyle(child).display === "contents") out.push(...layoutChildren(child));
    else out.push(child);
  }
  return out.filter((child) => child.getBoundingClientRect().width > 0);
}

/**
 * The width the chips may take without the composer's action row wrapping onto
 * a second line (which would make the composer taller): the footer's inner
 * width less everything else in it. bb lays the footer out as a wrapping row
 * holding the model controls and a wrapping group of actions, so both rows are
 * found by walking up from the chips. Null when the layout is not that shape;
 * the caller then shows every chip.
 */
function availableWidth(root: HTMLElement): { width: number; observe: HTMLElement[] } | null {
  const group = wrappingRowAbove(root);
  const footer = group === null ? null : wrappingRowAbove(group);
  if (group === null || footer === null) return null;
  const mine = childOf(group, root);
  if (mine === null) return null;
  const gap = (row: HTMLElement) => parseFloat(getComputedStyle(row).columnGap) || 0;
  const widthOf = (element: HTMLElement) => element.getBoundingClientRect().width;
  // A sibling may be stretched to fill free space (bb's model controls are), so
  // its width says nothing about what it needs: use where its content ends.
  const intrinsic = (element: HTMLElement) => {
    const left = element.getBoundingClientRect().left;
    const ends = layoutChildren(element).map((child) => child.getBoundingClientRect().right - left);
    return ends.length === 0 ? widthOf(element) : Math.min(widthOf(element), Math.max(...ends));
  };
  const others = (row: HTMLElement, skip: HTMLElement, size: (element: HTMLElement) => number) => {
    const kids = layoutChildren(row).filter((child) => child !== skip);
    return kids.reduce((sum, child) => sum + size(child), 0) + gap(row) * kids.length;
  };
  const footerStyle = getComputedStyle(footer);
  const inner = footer.clientWidth - parseFloat(footerStyle.paddingLeft) - parseFloat(footerStyle.paddingRight);
  const groupInBar = childOf(footer, group);
  if (groupInBar === null) return null;
  const width = inner - others(footer, groupInBar, intrinsic) - others(group, mine, widthOf) - 2;
  return { width: Math.max(0, width), observe: [footer, ...layoutChildren(footer), ...layoutChildren(group)] };
}

const chipClass =
  "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

function SkillButtonsAction() {
  const composer = useComposer();
  const { rpc, buttons, collapsed: storedCollapsed, setCollapsed } = useButtons();
  const commands = useCommands(rpc, resolveCommandTarget(composer.scope, composer.selection));
  const portalProps = usePortalScopeProps();
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  const busy = composer.isSubmitting;
  const list = buttons ?? [];
  const signature = list.map((button) => `${button.id}:${chipLabel(button)}`).join("|");
  const toggle = showToggle(list.length);
  const collapsed = isCollapsed(list.length, storedCollapsed);

  // Fit as many chips as the row has room for; the rest go to the "⋯" menu.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (root === null || measure === null) return;
    const observed: HTMLElement[] = [];
    const observer = new ResizeObserver(() => update());
    const update = () => {
      const widths = Array.from(measure.children).map((child) => (child as HTMLElement).getBoundingClientRect().width);
      const room = availableWidth(root);
      setShown(room === null ? widths.length : visibleChipCount(widths, roomForChips(room.width, toggle, CHIP_GAP, TOGGLE_WIDTH), CHIP_GAP, OVERFLOW_WIDTH));
      if (room !== null) {
        for (const element of room.observe) {
          if (!observed.includes(element)) {
            observed.push(element);
            observer.observe(element);
          }
        }
      }
    };
    observer.observe(root);
    update();
    return () => observer.disconnect();
  }, [signature, toggle, collapsed]);

  const run = useCallback(
    async (button: SkillButton) => {
      if (commands.status !== "ready" && commands.status !== "unknown") return;
      const command = commands.status === "ready" ? commands.byName.get(button.skill) : assumedSkillCommand(button.skill);
      if (command === undefined) return;
      const current = composer.draft;
      const next = composeDraft(current, button, command, { trimEnd: button.mode === "send" });
      try {
        composer.replace({ text: next.text, mentions: next.mentions as ComposerMention[] });
        if (button.mode === "insert") {
          composer.focus();
          return;
        }
        await composer.submit();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not run the skill button");
      }
    },
    [commands, composer],
  );

  if (list.length === 0) return null;
  if (collapsed) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-end">
        <button type="button" className={cn(chipClass, "px-2")} aria-label="Show skill buttons" title="Show skill buttons" onClick={() => setCollapsed(false)}>
          <Icon name="Zap" className="size-3.5" />
          <span>{list.length}</span>
        </button>
      </div>
    );
  }
  const count = shown ?? list.length;
  const visible = list.slice(0, count);
  const hidden = list.slice(count);

  const chip = (button: SkillButton) => {
    const reason = disabledReason(button, commands, busy);
    return (
      <button
        key={button.id}
        type="button"
        className={chipClass}
        disabled={reason !== null}
        title={reason ?? `${button.mode === "send" ? "Send" : "Insert"} /${button.skill}${button.args === "" ? "" : ` ${button.args}`}`}
        aria-label={`/${button.skill}`}
        onClick={() => void run(button)}
      >
        {chipLabel(button)}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-1 items-center justify-end" style={{ gap: CHIP_GAP }}>
      {visible.map(chip)}
      {hidden.length === 0 ? null : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className={cn(chipClass, "justify-center px-0")} style={{ width: OVERFLOW_WIDTH }} aria-label="More skill buttons" title="More skill buttons">
              ⋯
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content {...portalProps} side="top" align="end" sideOffset={8} className="z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
              {hidden.map((button) => {
                const reason = disabledReason(button, commands, busy);
                return (
                  <DropdownMenu.Item
                    key={button.id}
                    disabled={reason !== null}
                    title={reason ?? undefined}
                    onSelect={() => void run(button)}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    {chipLabel(button)}
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {toggle ? (
        <button type="button" className={cn(chipClass, "justify-center px-0")} style={{ width: TOGGLE_WIDTH }} aria-label="Hide skill buttons" title="Hide skill buttons" onClick={() => setCollapsed(true)}>
          <Icon name="ChevronRight" className="size-3.5" />
        </button>
      ) : null}
      {/* Off-screen copy at natural width, so the row can be measured without flicker. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max overflow-hidden" style={{ gap: CHIP_GAP }}>
        {list.map((button) => (
          <span key={button.id} className={chipClass}>
            {chipLabel(button)}
          </span>
        ))}
      </div>
    </div>
  );
}

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SettingsSection() {
  const { rpc, buttons } = useButtons();
  const commands = useCommands(rpc, { kind: "latest" });
  const [rows, setRows] = useState<SkillButton[] | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (buttons !== null && rows === null) {
      setRows(buttons);
      setSaved(JSON.stringify(buttons));
    }
  }, [buttons, rows]);

  const suggestions = useMemo(
    () => (commands.status === "ready" ? [...commands.byName.values()].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [commands],
  );

  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const dirty = JSON.stringify(rows) !== saved;
  const update = (index: number, patch: Partial<SkillButton>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target] as SkillButton, next[index] as SkillButton];
    setRows(next);
  };
  const add = () => {
    if (!canAddButton(rows.length)) return;
    const id = newButtonId(rows.map((row) => row.id), () => crypto.randomUUID().slice(0, 8));
    setRows([...rows, { id, skill: "", emoji: "", label: "", mode: "insert", args: "" }]);
  };
  const save = async () => {
    const checked = validateButtons(rows);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setPending(true);
    try {
      const result = await rpc.call("saveButtons", { buttons: checked.buttons });
      setRows(result.buttons);
      setSaved(JSON.stringify(result.buttons));
      setError(null);
      toast.success("Skill buttons saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <datalist id="skill-buttons-skills">
        {suggestions.map((command) => (
          <option key={command.name} value={command.name} label={command.source === "skill" ? "skill" : "command"} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        Up to {MAX_BUTTONS} chips next to the composer's send button. <b>Insert</b> puts the skill and args at the start of the
        draft; <b>Send</b> submits them with the draft as one message. Skills come from{" "}
        {commands.status === "ready" ? "the most recent thread's provider" : "…"}; you can also type a name.
        {commands.status === "error" ? ` (Skill list unavailable: ${commands.message})` : ""}
      </p>
      {rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          No buttons yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
              <Input className="w-14 text-center" value={row.emoji} maxLength={MAX_EMOJI} placeholder="🔍" aria-label={`Button ${index + 1} emoji`} onChange={(event) => update(index, { emoji: event.target.value })} />
              <Input className="w-24" value={row.label} maxLength={MAX_LABEL} placeholder="Label" aria-label={`Button ${index + 1} label`} onChange={(event) => update(index, { label: event.target.value })} />
              <Input className="w-56" list="skill-buttons-skills" value={row.skill} placeholder="skill name" aria-label={`Button ${index + 1} skill`} onChange={(event) => update(index, { skill: event.target.value })} />
              <select className={selectClass} value={row.mode} aria-label={`Button ${index + 1} mode`} onChange={(event) => update(index, { mode: event.target.value as ButtonMode })}>
                <option value="insert">Insert</option>
                <option value="send">Send</option>
              </select>
              <Input className="min-w-32 flex-1" value={row.args} maxLength={MAX_ARGS} placeholder="Args (optional)" aria-label={`Button ${index + 1} args`} onChange={(event) => update(index, { args: event.target.value })} />
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Move button ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <Icon name="ArrowUp" className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Move button ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                <Icon name="ArrowDown" className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" aria-label={`Delete button ${index + 1}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                <Icon name="Trash2" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span title={canAddButton(rows.length) ? undefined : `At most ${MAX_BUTTONS} buttons`}>
          <Button variant="outline" size="sm" onClick={add} disabled={!canAddButton(rows.length)}>
            <Icon name="Plus" className="size-4" />
            Add button ({rows.length}/{MAX_BUTTONS})
          </Button>
        </span>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || pending}>
          Save
        </Button>
        {dirty ? (
          <Button variant="ghost" size="sm" onClick={() => { setRows(JSON.parse(saved) as SkillButton[]); setError(null); }}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "buttons",
    title: "Skill buttons",
    description: "Quick-launch chips for skills next to the thread composer.",
    component: SettingsSection,
  });
  app.composer.customize({
    id: "skill-buttons",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "chips", component: SkillButtonsAction }],
  });
});
