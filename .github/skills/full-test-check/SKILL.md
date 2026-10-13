---
name: full-test-check
description: Run the project's comprehensive tests and quality checks when the user explicitly requests a full validation.
---

# Full test and quality check

Run this workflow only when the user explicitly invokes this skill or asks for
comprehensive/full testing. Do not apply it automatically to routine changes.

## Workflow

1. Inspect the repository's package manifests, task configuration, and CI
   workflows to identify the checks the project actually supports.
2. Run the complete available test suite, not only tests related to the latest
   change.
3. Run all configured static checks, such as linting and type checking, and the
   production build when the project defines them.
4. If a check fails, report the failure and relevant output. Do not suppress
   failures or claim that an unavailable check passed.
5. Summarize every check that ran and its result, and explicitly list relevant
   checks that could not be run because the project does not provide them.

Prefer the repository's existing scripts and CI commands. Do not install new
dependencies or add test tooling just to make this workflow appear complete;
ask before expanding the project's tooling.
