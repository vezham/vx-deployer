# GitHub Copilot Instructions

## Commit Messages

- Apply these rules to the commit title/Summary field itself, not just the body.
- When GitHub Desktop requests JSON, preserve its `title` and `description`
  fields. The `title` value MUST be `<type>(<scope>): <subject>`.
  For plain-text output, use that same format on the first line. Do not add a
  preamble or Markdown wrapper.
- Every generated Git commit message MUST begin with exactly
  `<type>(<scope>): <subject>`.
- The scope is mandatory. Never generate `<type>: <subject>`,
  `<type>(): <subject>`, or a header without both parentheses.
- Use [commitlint.config.cjs](../commitlint.config.cjs) as the single source of
  truth for allowed types, scope resolution and normalization, multi-scope
  constraints, length limits, and all other validation rules. Do not maintain
  separate lists or path-to-scope mappings in these instructions.
- Choose the type and scope from the current configuration and affected Nx
  projects. Do not invent fallback values when configuration is unavailable.
- Apply the configured length limit to the complete header, including its
  prefix. Shorten the subject rather than omit required fields.
- Validate with the repository's Commitlint configuration when tools are
  available. If the generator cannot access the configuration or run validation,
  do not claim the message has been validated; the commit-msg hook enforces it.

## Subject

- Keep the subject concise and action-oriented.
- Use imperative mood (e.g. `add`, `fix`, `rename`, `remove`, `update`).
- Preserve the exact casing of technical identifiers (e.g. `V_BASE_API_MODE`, `React`, `Next.js`, `TypeScript`, `@vx/start`) when they improve clarity.
- Do not repeat implementation details already described in the body.

## Body

- For plain text, leave a blank line after the header. For GitHub Desktop JSON,
  put the body in `description` and keep the complete header in `title`.
- Briefly explain `what changed` and `why`, when useful.
- Format every non-empty description/body as a bullet list, even for a single
  item. Start each item with `- ` and put each item on its own line. Do not add
  an introductory paragraph or heading.
- In GitHub Desktop JSON, encode line breaks between bullet items as `\n`
  inside the `description` string. Use an empty string when no body is needed.
- Mention renamed APIs, types, files, packages, or breaking changes explicitly.

### Output Format

When GitHub Desktop requests JSON, use this structure, replacing the placeholders
with values selected under the current Commitlint configuration:

```json
{
  "title": "<type>(<scope>): <subject>",
  "description": "- <what changed and why>\n- <another change, if needed>"
}
```

For plain text, use the same title as the first line and place any body after a
blank line.
