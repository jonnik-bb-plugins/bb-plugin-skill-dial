# Skill Buttons

A BB plugin that adds quick-launch buttons for skills next to the thread
composer.

## What you get

- Up to **6** compact chips (emoji + short label) in the composer's bottom action
  row, left of the send button. Chips that do not fit collapse into a **⋯** menu,
  so the composer keeps its height and no built-in control is covered.
- Settings (Settings → Plugins → Skill Buttons → **Skill buttons**): per button
  a skill (suggestions from the most recent thread's `/` list, free text also
  accepted), emoji, label, mode and optional args; move up/down and delete.
  The sixth button is the last one: **Add button** is disabled at 6/6, and the
  server rejects a longer list too.
- **Insert** mode: the skill pill (the one bb's `/` menu inserts) plus the args go
  to the start of the current draft; the rest of the draft stays; the composer is
  focused; nothing is sent.
- **Send** mode: the same composition, then `useComposer().submit()`, so
  attachments, queueing and send checks behave as for Enter. An empty draft sends
  the skill (and args) alone.
- A small chevron at the end of the chip group collapses everything into one
  compact chip (bolt + button count, tooltip "Show skill buttons"); clicking it
  expands again. It shows only with 2 or more buttons, is never part of the "⋯"
  menu, and its state is global and stored on the server, so it follows you across
  reloads, browsers and devices.
- A chip is disabled, with a tooltip, while the skill list loads or fails, or
  when the skill is not offered for the thread's provider.

Settings are global; there are no per-project overrides. Chips appear in thread
composers and the new-thread composer (not queued-message editors). In the
new-thread composer the skill list follows the selected provider, project and
environment, and is re-read when they change; if it cannot be read (for example
a project with no checkout), the chips stay enabled and the skill is assumed to
exist. `Send` there uses the composer's normal submit, which creates the thread.

## How it works

- `lib/buttons.ts` — the button schema and 6-button cap, draft composition for
  both modes, the chips/overflow split and the collapse rules. Pure; covered by `test/`.
- `server.ts` — stores the list in `bb.storage.kv` (RPC `getButtons` /
  `saveButtons`, `setCollapsed`, realtime `buttons-changed`) and lists the commands and
  skills for a thread or a new-thread selection with `bb.sdk.projects.commands`, as bb's own `/` menu does (RPC
  `listCommands`, cached 30 s).
- `app.tsx` — `app.composer.customize({ actions })` for the chips and
  `app.slots.settingsSection` for the settings. The chip row is measured against
  bb's footer layout (a wrapping row of the model controls and the actions); if
  that layout changes shape, all chips are shown.

## Requirements

bb ≥ 0.49 (Plugin SDK ≥ 0.6.132). Uses the experimental composer API.

## Development

```
npm install
npm test            # node --test: schema/cap and draft composition
npm run typecheck
bb plugin build
bb plugin install .
```
