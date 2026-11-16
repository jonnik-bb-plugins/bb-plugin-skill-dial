Launch a skill with one click from the thread composer.

## What you get

- Up to six compact chips (emoji and short label) in the composer's action row,
  left of the send button. When the row is too narrow, extra chips collapse into
  a "⋯" menu; the composer never grows taller.
- A **Skill buttons** section in the plugin's settings: pick a skill, a label
  and emoji, a mode and optional args; reorder and delete buttons.
- A chevron collapses the chips into one compact chip; the state is remembered
  on the server across reloads and devices.
- Two modes per button. **Insert** puts the skill pill and args at the start of
  the draft and focuses the composer. **Send** prepends them to the draft and
  submits it as one message, or submits the skill alone when the draft is empty.
- A chip is disabled, with a tooltip, when its skill is not available for the
  thread's provider.

## How it works

The button list is global (all projects) and lives in this plugin's own storage
on the BB server. The skill list is the one bb's own `/` menu shows for the
thread. Nothing leaves the machine.
