# Validation defaults

- Do not run the full test and quality-check suite by default for every change.
- Run focused checks only when they are needed to validate the changed behavior or
  the user asks for them.
- Run the comprehensive validation workflow only when the user explicitly asks
  for it or invokes the `full-test-check` skill.
- Report which checks were run and identify checks that were not run; never imply
  that a skipped check passed.

# Form UX

- When opening a create or edit form, focus the first and highest-priority
  input/control so users can start immediately. Order the form to match that
  priority; when the control mounts asynchronously, focus it after it is ready.
