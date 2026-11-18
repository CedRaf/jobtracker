# Working agreement

## Consult before implementing anything not explicitly asked for

Only implement what I explicitly asked for. When a request leaves the *how* open,
or a fix needs something I didn't mention, **propose it and wait for my go-ahead**
before writing code.

This includes:

- **New mechanisms or integrations.** GitHub issues, labels, bots, webhooks, external
  services, new secrets, new dependencies, scheduled jobs. Example: I asked for a
  separate email about LinkedIn rate limits; the alert should not have been built on
  GitHub issues without asking me first.
- **Choosing between approaches.** If there's more than one reasonable way to do it,
  lay out the options with their trade-offs and recommend one. Don't pick one and build it.
- **Scope beyond the request.** Extra features, refactors, behaviour changes in other
  parts of the app, or "while I'm here" fixes: mention them, don't do them.
- **Anything that leaves traces outside the code**, such as repository settings,
  issues, labels, database rows, or deployments.

Small, mechanical parts of an agreed change (tests for it, docs that describe it, a
type or column the change obviously needs) don't need a separate check.

When unsure whether something counts, ask.

## Other preferences

- Don't commit unless I ask. I review changes before committing.
