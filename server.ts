// bb-plugin-skill-buttons — backend. Stores the (global) button list and
// resolves which skills the thread's provider offers, as bb's own `/` menu does.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { buttonSchema, buttonsSchema, MAX_BUTTONS, readStoredButtons, type SkillButton } from "./lib/buttons.ts";

const commandSchema = z.object({
  name: z.string(),
  source: z.enum(["command", "skill"]),
  origin: z.enum(["builtin", "project", "user"]),
  argumentHint: z.string().nullable(),
  description: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  getButtons: {
    input: z.null(),
    output: z.object({ buttons: z.array(buttonSchema) }),
  },
  saveButtons: {
    // `buttonsSchema` enforces the 6-button cap on the server as well.
    input: z.object({ buttons: buttonsSchema }),
    output: z.object({ buttons: z.array(buttonSchema) }),
  },
  // Skills and commands for a thread's provider; without a thread, for the
  // most recently active one (the settings page has no thread of its own).
  listCommands: {
    input: z.object({ threadId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable() }),
    output: z.object({ commands: z.array(commandSchema), error: z.string().nullable() }),
  },
});

const BUTTONS_KEY = "buttons";
const BUTTONS_CHANGED = "buttons-changed";
const COMMANDS_TTL_MS = 30_000;

type Command = z.infer<typeof commandSchema>;

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  async function readButtons(): Promise<SkillButton[]> {
    return readStoredButtons(await bb.storage.kv.get<unknown>(BUTTONS_KEY));
  }

  const cache = new Map<string, { at: number; commands: Command[] }>();

  async function commandsForThread(threadId: string | null) {
    let thread;
    if (threadId !== null) {
      thread = await bb.sdk.threads.get({ threadId });
    } else {
      thread = (await bb.sdk.threads.list({ limit: 1 }))[0];
      if (thread === undefined) throw new Error("Open a thread to list its skills.");
    }
    const key = `${thread.projectId}|${thread.providerId}|${thread.environmentId ?? ""}`;
    const hit = cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < COMMANDS_TTL_MS) return hit.commands;
    const routing = thread.environmentId === null ? {} : { environmentId: thread.environmentId };
    const { commands } = await bb.sdk.projects.commands({
      projectId: thread.projectId,
      provider: thread.providerId,
      ...routing,
    });
    const list: Command[] = commands.map((command) => ({
      name: command.name,
      source: command.source,
      origin: command.origin,
      argumentHint: command.argumentHint,
      description: command.description,
    }));
    cache.set(key, { at: Date.now(), commands: list });
    return list;
  }

  bb.rpc.register(rpcContract, {
    getButtons: async () => ({ buttons: await readButtons() }),
    saveButtons: async ({ buttons }) => {
      const stored = buttons.slice(0, MAX_BUTTONS);
      await bb.storage.kv.set(BUTTONS_KEY, stored);
      bb.realtime.publish(BUTTONS_CHANGED, { count: stored.length });
      return { buttons: stored };
    },
    listCommands: async ({ threadId }) => {
      try {
        return { commands: await commandsForThread(threadId), error: null };
      } catch (cause) {
        return { commands: [], error: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  });
}
