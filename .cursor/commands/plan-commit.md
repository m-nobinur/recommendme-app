Review all recent changes in the repository and classify them into appropriate categories, including but not limited to:
- Features
- Bug fixes
- Enhancements / Improvements
- Refactors
- Chores / Maintenance
- Performance optimizations
- Security-related changes
- Database / Migration changes
- Configuration / Infrastructure changes
- Documentation updates
- Tests (additions, updates, fixes)

If additional categories are required, create them as needed.

Plan commits based on these categories. Do not combine unrelated concerns or large changes into a single commit. Each commit should represent a logical, reviewable unit of work.

For each planned commit:
- Stage only the files relevant to that change
- Run linting, formatting, and tests (where applicable) and ensure they pass
- Ensure no unnecessary or generated files are included

Commit message guidelines:
- Use short, clear, and human-readable messages written in plain, professional English
- Avoid jargon, emojis, or vague wording
- Clearly describe *what* changed and *why* when necessary
- If the change is large or impactful, include brief, meaningful details in the commit body

General standards:
- Follow best practices used by experienced software engineers
- Optimize for clarity, maintainability, and ease of code review
- Prefer multiple small, focused commits over fewer large ones
- Ensure commits reflect intentional, high-quality engineering work
