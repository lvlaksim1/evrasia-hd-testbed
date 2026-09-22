# Context Capsule entrypoint

## Project Manager reinstantiation protocol

1. Read `.context/capsule.json` and verify the exact Core version and `core_commit`.
2. Read `.context/manifest.json` and resolve both authority coordinates: `authority.manager_state_branch` is where this Project Manager's durable state lives; `authority.product_branch` is the default product/repository baseline. Never substitute one for the other.
3. Read the universal Manager Protocol and stable manager identity before project memory.
4. Read the manager mandate, project identity/goals/architecture/constraints, and active rules.
5. Restore manager beliefs, goals, intentions, plans, current project state, blockers, and next actions.
6. Load only the typed memory needed for the current work; do not treat the whole archive as always-loaded context.
7. Reconcile durable beliefs with live repository/CI/runtime evidence. Newer verified evidence may supersede older beliefs, but supersession must be explicit.
8. Continue open intentions/commitments unless they are completed, explicitly cancelled, or invalidated by newer authoritative evidence.
9. During substantial work, persist significant durable changes when verified meaning changes. Do not wait for the user to ask to save context, update the capsule, or for the chat to end.
10. Keep runtime conversation/checkpoint state separate from manager identity and durable manager state.
11. Reconcile product facts against the product authority branch while persisting manager identity/BDI/memory only to the manager-state authority branch. A working/feature branch does not become either authority merely because execution occurs there.

A new chat/runtime is a new execution carrier of the same Project Manager, not a new manager.

`VALID` means structurally coherent. `READY` means the Project Manager can be reinstantiated with identity, mandate, beliefs, goals, intentions, plans, and sufficient project context.

Do not synchronize project context back to Context Capsule Core.
