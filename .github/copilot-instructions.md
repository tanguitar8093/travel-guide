# Development workflow

- Follow `.github/skills/travel-development-workflow/SKILL.md` for every
  development task. These rules are project-wide and apply automatically.
- Do not automatically run Playwright, `npm run build`, lint commands, `git diff`,
  `git diff --check`, or git check commands. Finish implementation first, then
  ask the user whether they authorize testing. Run only the checks covered by
  that approval; an explicit request to test is approval.
- Before reading any project Markdown documentation to guide implementation,
  ask the user which specific files may be consulted. Do not read other project
  Markdown files unless the user authorizes them.
- For every feature that changes or creates data, account for standalone local,
  cloud, and hybrid local/cloud operation. Prefer the existing automatic-sync
  path where available; do not implement a cloud-only flow that leaves hybrid
  local changes unsynced. If the existing architecture cannot meet this, explain
  the limitation and ask before proceeding with a weaker behavior.

# Form UX

- When opening a create or edit form, focus the first and highest-priority
  input/control so users can start immediately. Order the form to match that
  priority; when the control mounts asynchronously, focus it after it is ready.
