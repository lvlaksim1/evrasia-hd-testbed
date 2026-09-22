# Project architecture

The copied project is an Expo / React Native application. The current snapshot contains the application implementation in `App.tsx`, API/storage modules under `lib/`, seed data under `data/`, project-specific Expo configuration/plugin code, and the source repository's release workflows.

The documented release boundary is:

`L3 Evrasia HD build adapter → L2 Universal APK Release → L1 Universal Release Core`.

L3 performs project-specific pnpm/TypeScript/Expo preprocessing and returns an unsigned APK candidate. Production signing belongs to L2; release gating, numbering, transactional publication, recovery and remote verification belong to L1.

GitHub Actions are intentionally disabled at repository level in this isolated copy. The workflow files remain part of the copied product snapshot as architecture/evidence, but must not be treated as currently executing production automation.
