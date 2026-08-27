# Enlistment — the `.mcp.json` shape

<!-- Chunk 1 child B (node P2-N008). This is a template and a
     proposal, not a live configuration: this repository does not
     enlist itself (it has no plan state to read), and the
     coordinating repository is deliberately NOT enlisted by this
     task — checking a live `.mcp.json` into
     majodali/project-orchestrator is a change to that repository, and
     belongs to the Orchestrator/owner, not to this repository's work.
     This document exists so that change is a five-minute copy from a
     reviewed template rather than a design decision made at commit
     time. -->

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
  [`docs/runbook.md`](runbook.md) Step 2 reports after deploy. Never a
  literal placeholder in the committed file — it is public (an API
  Gateway URL, not a secret) but still needs to name the real,
  deployed endpoint.
- **`timeout`** — the MCP default is 5000 ms, far too low for a
  cold-starting Lambda (R11); this template ships a conservative
  30000 ms placeholder pending the real cold/warm measurement
  `docs/runbook.md` Step 7 records once a deployment exists. Whoever
  commits the live file should set this from that measurement, not
  leave the placeholder.

## The token

`${MCP_AUTH_TOKEN}` is environment-variable expansion (decision 5 of
the p2-n002 plan) — the literal four characters `${MCP_AUTH_TOKEN}`
belong in the committed file; the token itself never does. Each
surface that enlists this server needs `MCP_AUTH_TOKEN` set in its own
environment (`docs/runbook.md` Step 4 and Step 6) — how a given Claude
Code surface exposes environment variables to an enlisted session is a
surface-configuration detail outside this repository's scope to
document (out of scope per this document's Not verified here /
[I6](https://github.com/majodali/project-orchestrator/blob/main/docs/specs/p2-n002-service-skeleton.md)
distinction between "the file is right" and "the surface delivers the
variable").

## Committing this

Proposed, not done here: adding the filled-in `.mcp.json` to
`majodali/project-orchestrator`'s repository root is a change to that
repository and belongs to whoever holds write scope there (the
Orchestrator, on the owner's authority) — see this task's result for
the exact proposal. This repository (`project-orchestrator-service`)
carries the template and this explanation, not the live file.
