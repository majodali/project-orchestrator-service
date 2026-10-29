# Enlistment — the `.mcp.json` shape

<!-- Chunk 1 child B (node P2-N008). This is a template and a
     proposal, not a live configuration: this repository does not
     enlist itself (it has no plan state to read). The coordinating
     repository is enlisted: majodali/project-orchestrator checked in
     its own `.mcp.json` on 2026-08-28, following this template, and
     its `docs/process/enlistment.md` is the procedure. This document
     keeps the template and the reasoning behind its two values.
     Corrected 2026-10-29 (task T051, K-011): this comment said the
     coordinating repository was deliberately not enlisted. That was
     true when node P2-N008 wrote it and stopped being true on
     2026-08-28. -->

## Where it goes

A `.mcp.json` at the **root of `majodali/project-orchestrator`**
(the coordinating repository), checked into git — the same mechanism
that already carries this project's role-agent mirror
(`.claude/agents/`). Claude Code reads a repository-root `.mcp.json`
automatically on both the local and web surfaces once the repository
is cloned; no other client-side configuration is enlistment-specific.

## The template

See [`mcp-enlistment.template.json`](mcp-enlistment.template.json):

```json
{
  "mcpServers": {
    "project-orchestrator": {
      "type": "http",
      "url": "https://REPLACE-WITH-ENDPOINT-FROM-RUNBOOK-STEP-2/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      },
      "timeout": 30000
    }
  }
}
```

Two placeholders a proposer must fill in before this is committed
anywhere:

- **`url`** — `<Endpoint>/mcp`, where `<Endpoint>` is the value
  [`docs/runbook.md`](runbook.md) Step 3 reports after deploy. Never a
  literal placeholder in the committed file — it is public (an API
  Gateway URL, not a secret) but still needs to name the real,
  deployed endpoint.
- **`timeout`** — the MCP default is 5000 ms, far too low for a
  cold-starting Lambda (R11); this template ships a conservative
  30000 ms placeholder pending the real cold/warm measurement
  `docs/runbook.md` Step 8 records once a deployment exists. Whoever
  commits the live file should set this from that measurement, not
  leave the placeholder.

## The token

`${MCP_AUTH_TOKEN}` is environment-variable expansion (decision 5 of
the p2-n002 plan) — the literal four characters `${MCP_AUTH_TOKEN}`
belong in the committed file; the token itself never does. Each
surface that enlists this server needs `MCP_AUTH_TOKEN` set in its own
environment (`docs/runbook.md` Step 5 and Step 7) — how a given Claude
Code surface exposes environment variables to an enlisted session is a
surface-configuration detail outside this repository's scope to
document (out of scope per this document's Not verified here /
[I6](https://github.com/majodali/project-orchestrator/blob/main/docs/specs/p2-n002-service-skeleton.md)
distinction between "the file is right" and "the surface delivers the
variable").

## Committing this

Done in the coordinating repository, not here.
`majodali/project-orchestrator` checked in its filled-in `.mcp.json`
at its repository root on 2026-08-28, with the deployed endpoint and
the 30000 ms timeout. Its
[`docs/process/enlistment.md`](https://github.com/majodali/project-orchestrator/blob/main/docs/process/enlistment.md)
gives the steps from not enlisted to enlisted, and its References
name this repository's template as where the file's values come from. This repository
(`project-orchestrator-service`) carries the template and this
explanation, not the live file.

> **Corrected 2026-10-29 (task T051, K-011).** This section said
> adding the `.mcp.json` to the coordinating repository was proposed,
> not done. That stopped being true on 2026-08-28.
