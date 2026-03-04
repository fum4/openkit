# This document outlines quick wins or bug fixes

## Misc

- Clean up CLI & corresponding website docs

- Rename .openkit to .ok

- 🚧 After authenticating GitHub the UI does not automatically refresh

- ✅ Use dialogs for commit message / PR name (worktree view)

- 🚧 Don't show cursor pointer on disabled / non-actionable buttons (e.g. Push button from worktree view when its in loading state)

- Renaming a branch will cause unexpected behavior with following git actions (e.g. Open PR)

- ✅ Add icons to info banners for integrations (chain) and settings (settings) page
  - ✅ Use gear icon for settings info banner

- ✅ Add icons to worktree view top-right buttons (Open in, View worktree, View PR, etc.). use corresponding icons (e.g. linear icon for view in linear). make these icons greyed out and color them on hover
  - ✅ Use GitHub icon for View PR button

- ✅ Update website download link to use latest release from the new repo

- ✅ Remove colored border from setup screen integration cards

- ✅ I connected to linear through the setup screen and the Issues tab did not show up in the workspace until i visited Integrations page (integrations loaded up) and then go back to workspace and refresh. this is the first issue, we should load everything from all pages in the background when app initializes, should not wait to visit corresponding pages. and second of all, the Issues tab should appear even if no jira/linear integration is setup, as users can create local issues without any integration

- ✅ When the "found x mcps and y skills on this device" banner is displayed on the agents page, if we click on "Import" the dialog should display the page with the list of skills/mcps/etc in order for us to check them and import, no need to display the "where to scan" page.
  - ✅ autoscan on agents page is not working anymore, we see the info banner directly and it doesnt even have scan & import button
    - ✅ if we already scanned the system through the banner, we should not rescan when clicking the banner "Import" button, we already have everything scanned

- ✅ Use chain icon for "Add integrations" button on workspace screen

- 🔴 Fix Linear attachments (they are not rendered)

- ✅ Update jira icon in workspace add menu popover (we still use the broken version, update everywhere is needed)

- ✅ When hovering the "refresh" button from issues sidebar, add backgrund to it, and do not show hover effect on issue header
  - ✅ the section header hover background is no longer displayed. it should be, it should NOT be displayed ONLY when we hover the refresh icon. also, make the refresh icon background a bit larger

- ✅ Swap disconnect icon from integrations page cards with logout icon
  - ✅ use shut down icon

- ✅ Add loading animation to commit / push / pr buttons from worktree view

- ✅ Add view PR button that redirects to github when PR is opened (both worktree and issue view)

## Notifications

- ✅ If we click on notifications button while notifications are open (or on anywhere outside the popup) we should close the popup

- ✅ Make sure notifications are listed in chronological order (most recent first) - no matter the notification type

- 🚧 In notificatiosn list, there should be a top section, differentiated from the rest of the notifications, dedicated specifically to agents that require user action. If an agent requires user input it should notify our server and we should display a notification for this

- ✅ Make it obvious in notifications title what kind of hooks we are talking about (pre-implementation, post-implementation, etc.)

- ✅ Use the hook icon for hook-related notifications, not the agent icon

- ✅ Add checkboxes / X icons (plain, no circle), loading circle to success / failed / in progress hooks/skills/commands in notifications list

- ✅ Remove filters (all / agent / worktree)

- ✅ Get rid of the separate, persistent "notification" overlay presented when running hooks (the yellow-brownish one); there should only be ONE notification in the notifications list that can be expanded inline and show all skills/commands that are part of the hook and their live status (running, completed, failed). Make this look pretty. we can make the notifications overlay bigger, if you see fit

- ✅ Remove "System" notifications from notifications popup

## Hooks

- ✅ Pre-implementation hooks are NOT run -- fix this

- 🚧 Custom hooks do not seem to work reliable, these also don't seem to be called -- fix this (e.g. i have a custom hook called "run after analysis" with the description "run this hook after you grasp what you need to do for this task. output what you understood needs to be done", i would expect this to be run by agents after they understand what needs to be done -- was not fired)

- ✅ While skills / commands are running show their cards without bg, use dashed border, just like their initial style (in worktree > hooks tab)

- ✅ All hooks should also be able to run "prompts" besides "skills" and "commands", which is a prompt that will be served to the agent to interpret and do whatever is mentioned there. add new "Add" buttons for all types of hooks, except for custom hooks, where we should provide user an extra input for the prompt. if the prompt input is filled user should be able to save the hook (same as with commands or skills). On-demand hooks should not have this functionality

- 🚧 Fix bug where you cannot remove skills from hooks (post-implementation) - they reappear after being removed? - not sure about this, should be carefully verified

- ✅ Swap X with circle icon with simple X in worktree > hooks tab for failed hooks
