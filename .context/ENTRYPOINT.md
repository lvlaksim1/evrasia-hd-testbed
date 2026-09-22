# Context Capsule entrypoint

## Recovery protocol

1. Read `.context/capsule.json` and verify the exact Core version and `core_commit`.
2. Read `.context/manifest.json`.
3. Read project identity, goals, architecture, and constraints.
4. Read active rules and durable decisions.
5. Read current state, blockers, next actions, and the latest handoff.
6. Reconcile the recovered semantic state with live repository/CI/runtime evidence.
7. Treat verified newer repository facts as authoritative and update the capsule when they change durable project meaning.
8. Persist significant durable changes during normal work. Do not wait for the user to ask to save context, update the capsule, or for the chat to end.

A structurally valid capsule is not necessarily recovery-ready. Use `capsulectl ready` before relying on it for a fresh-chat handoff.

Do not synchronize project context back to Context Capsule Core.
