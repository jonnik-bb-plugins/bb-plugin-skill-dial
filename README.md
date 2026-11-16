# Skill Dial

A BB plugin: a speed dial for skills. Quick-launch chips sit next to the thread
composer's send button.

## What you get

- Any number of compact chips (emoji + short label) in the composer's bottom
  action row, left of the send button. The chips form a horizontally scrollable
  strip that takes the room between the model controls and mic/send: vertical
  wheel or trackpad scroll over it scrolls sideways, touch swipe works, the
  scrollbar is hidden, clipped edges fade. Focusing a clipped chip with the
  keyboard scrolls it into view. On narrow composers (under 560 px wide, so on phones) chips show only their
  emoji, touch-sized; the label and skill move to the tooltip and accessible
  name, and a chip without an emoji shows its label cut to six characters.
  The composer keeps its height and no built-in control is covered.
- Settings (Settings → Plugins → Skill Dial → **Skill Dial**): per button
  a skill (suggestions from the most recent thread's `/` list, free text also
  accepted), emoji, label, mode and optional args; move up/down and delete.
  There is no limit on the number of buttons; the action bar with **Add button**
  and **Save** stays visible while a long list scrolls.
- **Insert** mode: the skill pill (the one bb's `/` menu inserts) plus the args go
  to the start of the current draft; the rest of the draft stays; the composer is
  focused; nothing is sent.
- **Send** mode: the same composition, then `useComposer().submit()`, so
  attachments, queueing and send checks behave as for Enter. An empty draft sends
  the skill (and args) alone.
- **Selected text is the parameter.** Select text before pressing a chip. Text selected
  outside the composer (in the chat, say) becomes the skill's argument, line breaks kept:
  the draft turns into the skill pill, the button's args, the selected text, then your
  existing draft. Text selected inside the draft gets the skill pill and args placed
  right before it, and the rest of the draft stays put. With nothing (or only
  whitespace) selected, a chip works as before. Keyboard activation uses the selection
  made just before focus moved onto the chip, if it still stands.
- A small chevron after the strip (outside the scroll area, always visible) collapses everything into one
  compact chip (bolt + button count, tooltip "Show Skill Dial"); clicking it
  expands again. It shows only with 2 or more buttons, and its state is global and stored on the server, so it follows you across
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

- `lib/buttons.ts` — the button schema, draft composition for both
  modes, strip sizing and scrolling rules, and the collapse rules. Pure; covered by `test/`.
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
npm test            # node --test: schema, draft composition, strip and collapse rules
npm run typecheck
bb plugin build
bb plugin install .
```
