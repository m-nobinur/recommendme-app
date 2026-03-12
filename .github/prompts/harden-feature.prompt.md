---
name: Harden Feature
description: "Implement and validate fixes for all review findings to make a feature production-ready in recommendme-app."
argument-hint: "Paste review findings plus feature scope, branch/commit range, changed files, and priorities."
agent: "Feature Hardening"
---
Take the provided review findings and fully remediate them using the `Feature Hardening` custom agent workflow.

Use the user-provided arguments as required input, including:
- Review findings (Blocker/High/Medium/Low)
- Feature scope
- Branch or commit range
- Changed files
- Risk priorities and constraints

Execution requirements:
- Implement all valid fixes in code, not just recommendations.
- Handle edge cases, failure modes, and tenant-isolation/security hardening.
- Add or update tests to cover fixes and regressions.
- Run validation commands and include actual outcomes.
- Update docs/changelog artifacts when behavior changes.

Return the final response in the agent's required 11-section output format.
