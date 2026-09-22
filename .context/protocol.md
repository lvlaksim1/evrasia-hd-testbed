# Context Capsule protocol

## Purpose

A fresh chat or agent with no conversation history must be able to recover the project's durable meaning and continue from the repository alone.

## Durable layers

- `project/` — identity, goals, architecture, constraints.
- `rules/` and `decisions/` — binding rules and accepted/rejected durable choices.
- `current/` — compact current state, unresolved blockers, and next actions.
- `handoffs/latest.md` — concise transfer to the next chat/agent.
- `dialogues/` — evidence-rich investigations when chronology matters.
- `history/` — older useful context.

## VALID vs READY

`VALID` means the capsule is structurally coherent and all indexed paths are safe and resolvable inside the repository.

`READY` additionally means the semantic recovery set is populated enough for a fresh chat to understand the project and continue: identity, goals, architecture, constraints, current state, next action, handoff, and at least one substantive active rule or durable decision.

## Semantic sync

Persist durable decisions, requirements, rules, architecture changes, root causes, rejected approaches, milestones, and priority changes.

Update durable context during normal work as soon as verified project meaning changes. Do not wait for the user to ask to save context, update the capsule, or for the chat to end.

Do not copy routine runtime churn such as heartbeats, leases, polling ticks, queue transitions, or transient CI state into `.context/`.

## Repository mutation

The canonical GitHub lifecycle prepares and validates the complete target snapshot before publication, creates one Git tree and one commit from the expected parent, rechecks the branch head, and performs a non-forced ref update.

If the branch moved, the ref is not updated. Unpublished Git objects may exist, but the target branch remains unchanged.

## Privacy

Never persist credentials, secret values, cookies, private keys, or unnecessary sensitive personal information.
