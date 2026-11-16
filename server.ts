// bb-plugin-skill-dial — backend. Stores the (global) button list and
// resolves which skills the thread's provider offers, as bb's own `/` menu does.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  buttonSchema,
  buttonsSchema,
  collapsedSchema,
  readStoredButtons,
  readStoredCollapsed,
  type SkillButton,
} from "./lib/buttons.ts";

const commandSchema = z.object({
  name: z.string(),
  source: z.enum(["command", "skill"]),
  origin: z.enum(["builtin", "project", "user"]),
  argumentHint: z.string().nullable(),
  description: z.string().nullable(),
});

const idSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/);
const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread"), threadId: idSchema }),
  z.object({
    kind: z.literal("new-thread"),
    projectId: idSchema,
    providerId: z.string().min(1).max(100),
    environmentId: idSchema.nullable(),
    hostId: idSchema.nullable(),
  }),
  // The settings page has no composer: use the most recently active thread.
  z.object({ kind: z.literal("latest") }),
]);

export const rpcContract = defineRpcContract({
  getButtons: {
    input: z.null(),
    output: z.object({ buttons: z.array(buttonSchema), collapsed: collapsedSchema }),
  },
  // Global (not per thread) so every browser and device sees the same state.
  setCollapsed: {
    input: z.object({ collapsed: collapsedSchema }),
    output: z.object({ collapsed: collapsedSchema }),
  },
  saveButtons: {
    input: z.object({ buttons: buttonsSchema }),
    output: z.object({ buttons: z.array(buttonSchema) }),
  },
  // Skills and commands bb's `/` menu offers: for a thread, for the provider and
  // project a new-thread composer has selected, or for the latest thread.
  listCommands: {
    input: z.object({ target: targetSchema }),
    output: z.object({ commands: z.array(commandSchema), error: z.string().nullable() }),
  },
});

const BUTTONS_KEY = "buttons";
const COLLAPSED_KEY = "collapsed";
const BUTTONS_CHANGED = "buttons-changed";
const COMMANDS_TTL_MS = 30_000;

type Command = z.infer<typeof commandSchema>;

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  async function readButtons(): Promise<SkillButton[]> {
    return readStoredButtons(await bb.storage.kv.get<unknown>(BUTTONS_KEY));
  }

  async function readCollapsed(): Promise<boolean> {
    return readStoredCollapsed(await bb.storage.kv.get<unknown>(COLLAPSED_KEY));
  }

  const cache = new Map<string, { at: number; commands: Command[] }>();

  type Routing = { projectId: string; provider: string; environmentId: string | null; hostId: string | null };

  async function routingFor(target: z.infer<typeof targetSchema>): Promise<Routing> {
    if (target.kind === "new-thread") {
      if (target.environmentId !== null || target.hostId !== null) {
        return { projectId: target.projectId, provider: target.providerId, environmentId: target.environmentId, hostId: target.hostId };
      }
      // No environment yet: ask the project's default checkout's machine, as bb's own menu does.
      const project = await bb.sdk.projects.get({ projectId: target.projectId });
      const sources = project.sources ?? [];
      const source = sources.find((candidate) => candidate.isDefault) ?? sources[0];
      const hostId = source?.hostId ?? (await bb.sdk.system.config()).primaryHostId;
      if (hostId === null || hostId === undefined) throw new Error("No machine to read skills from.");
      return { projectId: target.projectId, provider: target.providerId, environmentId: null, hostId };
    }
    let thread;
    if (target.kind === "thread") {
      thread = await bb.sdk.threads.get({ threadId: target.threadId });
    } else {
      thread = (await bb.sdk.threads.list({ limit: 1 }))[0];
      if (thread === undefined) throw new Error("Open a thread to list its skills.");
    }
    return { projectId: thread.projectId, provider: thread.providerId, environmentId: thread.environmentId, hostId: null };
  }

  async function commandsFor(target: z.infer<typeof targetSchema>) {
    const route = await routingFor(target);
    const key = `${route.projectId}|${route.provider}|${route.environmentId ?? ""}|${route.hostId ?? ""}`;
    const hit = cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < COMMANDS_TTL_MS) return hit.commands;
    const where =
      route.environmentId !== null ? { environmentId: route.environmentId } : route.hostId !== null ? { hostId: route.hostId } : {};
    const { commands } = await bb.sdk.projects.commands({ projectId: route.projectId, provider: route.provider, ...where });
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
    getButtons: async () => ({ buttons: await readButtons(), collapsed: await readCollapsed() }),
    setCollapsed: async ({ collapsed }) => {
      await bb.storage.kv.set(COLLAPSED_KEY, collapsed);
      bb.realtime.publish(BUTTONS_CHANGED, { collapsed });
      return { collapsed };
    },
    saveButtons: async ({ buttons }) => {
      await bb.storage.kv.set(BUTTONS_KEY, buttons);
      bb.realtime.publish(BUTTONS_CHANGED, { count: buttons.length });
      return { buttons };
    },
    listCommands: async ({ target }) => {
      try {
        return { commands: await commandsFor(target), error: null };
      } catch (cause) {
        return { commands: [], error: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  });
}
