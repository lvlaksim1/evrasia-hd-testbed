# Architecture

Документ описывает текущую структуру приложения «Евразия HD» и проектные границы, которые должны сохраняться при release-сборке.

<!-- AUTO-RELEASE-START -->
## Контрольная точка документа

- Актуально для релиза: **v14**
- Релизный commit: `92f6ba606bf1069c5128d91739df4b075fd413cf`
- Опубликован: `2026-09-10T23:25:14Z`
<!-- AUTO-RELEASE-END -->

## Проектные компоненты

- `app/(tabs)/index.tsx` — основной экран приложения.
- `app/_layout.tsx` и `app/(tabs)/_layout.tsx` — Expo Router layout.
- `lib/evrasia-api.ts` — интеграция с API.
- `lib/evrasia-storage.ts` — локальное хранение состояния.
- `data/evrasia-seed.ts` — исходные данные приложения.
- `plugins/with-sms-code.js` — project-specific Expo config plugin.
- `scripts/patch-draggable-autoscroll.mjs` — детерминированный postinstall patch зависимости.

## Release boundary

```text
L3 Evrasia HD build adapter
        ↓
L2 Universal APK Release
        ↓
L1 Universal Release Core
```

L3 выполняет pnpm/TypeScript/Expo preprocessing, проверяет generated Android project и возвращает unsigned APK candidate. L2 независимо проверяет APK, подписывает production key и передаёт проверенный artifact в L1. L1 отвечает за release gate, numbering, transactional publication, recovery, rollback и remote SHA verification.

## Критические инварианты

- исходный `app/(tabs)/index.tsx` не должен изменяться во время Expo prebuild;
- generated Android project обязан иметь `newArchEnabled=true`, `reactNativeArchitectures=arm64-v8a` и `adjustResize`;
- обязательный patch `EVRASIA_DIRECTIONAL_AUTOSCROLL` должен присутствовать после установки зависимостей;
- L3 возвращает только unsigned APK;
- production signing выполняется только L2;
- project-specific проверки не переносятся в universal L1/L2.
