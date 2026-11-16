Launch a skill with one click from the thread composer.

## What you get

- Any number of compact chips (emoji and short label) in the thread and
  new-thread composers' action row, left of the send button, in a horizontally
  scrollable strip with edge fades; on narrow screens chips shrink to their emoji; the composer never grows taller.
- A **Skill Dial** section in the plugin's settings: pick a skill, a label
  and emoji, a mode and optional args; reorder and delete buttons.
- Select text in the chat and press a chip: the selection becomes the skill's
  argument. Select text in your draft and the skill goes right before it.
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
