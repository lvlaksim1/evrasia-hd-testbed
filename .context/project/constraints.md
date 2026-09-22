# Project constraints

- Package identity is `com.evrasia.hd`.
- Production APK policy documented by the source project is arm64-only.
- Source release numbering uses numeric GitHub tags `vN`, with `versionCode=N` and `versionName=vN` for standardized releases.
- Project-specific release checks remain in L3 and must not silently migrate into universal L1/L2 logic.
- Production signing material must not be persisted in repository context.
- Actions are disabled in this isolated copy; do not enable publication, signing, Telegram delivery, or other external release effects without explicit owner direction.
