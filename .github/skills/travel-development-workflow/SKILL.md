---
name: travel-development-workflow
description: "Use for every development task in Travel Planner: implementation, bug fixes, refactors, UI changes, data changes, testing, or documentation. Enforces test approval, project-document approval, and local/cloud/hybrid data behavior."
---

# Travel Planner development workflow

This skill applies to every development task in this repository. The same
requirements are also stated in `.github/copilot-instructions.md` so they apply
without relying on the skill being manually invoked.

## Before implementation

1. Inspect relevant source code and existing behavior.
2. Before reading any project Markdown documentation to guide implementation,
   ask the user which specific files may be consulted. Read only the files they
   authorize. This includes docs referenced by another skill or project file.
   The user-provided task description and attachments are approved task context.
3. For a feature that creates or changes data, identify how the existing
   implementation behaves in standalone local, cloud, and hybrid local/cloud
   modes before choosing a persistence path.

## Data-change requirements

- Use the existing persistence facade and operation boundaries.
- Keep local, cloud, and hybrid behavior consistent. Prefer the existing
  automatic-sync path for hybrid writes so local changes can reach the cloud.
- Do not implement a cloud-only data operation that silently fails to update
  hybrid local state or its sync queue.
- If automatic synchronization is not implemented or the existing architecture
  cannot support the requested behavior, explain that limitation and ask the
  user before implementing a weaker or manual-sync-only alternative.

## Testing and commands

- Do not automatically run Playwright, `npm run build`, lint commands,
  `git diff`, `git diff --check`, or git check commands.
- Complete the implementation first. Then ask the user whether they authorize
  testing and name the checks proposed.
- Run only checks covered by the user's approval. An explicit user request to
  run a named test or check is authorization for that check only.
- Do not use browser automation as a substitute for asking permission.
- Report checks that were not authorized as not run; never imply they passed.

## Completion

Summarize the implementation and any known limitations. If validation was not
authorized, ask whether the user wants the proposed checks run after describing
the completed changes.
