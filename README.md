# Евразия HD

<!-- AUTO-RELEASE-START -->
## Текущий релиз

- Версия: **v14**
- `versionCode`: **14**
- `versionName`: **v14**
- package: `com.evrasia.hd`
- commit: `92f6ba606bf1069c5128d91739df4b075fd413cf`
- APK: `evrasia-hd-v14.apk`
- SHA-256: `a4a56e10bdc0d44cd144c39a8e29a3a694bfcd8959c5170364d2d787d4add09f`
- Опубликован: `2026-09-10T23:25:14Z`
- Предыдущий релиз: **v13**
- Release: https://github.com/lvlaksim1/evrasia-hd/releases/tag/v14
- APK: https://github.com/lvlaksim1/evrasia-hd/releases/download/v14/evrasia-hd-v14.apk
<!-- AUTO-RELEASE-END -->

Чистый репозиторий приложения «Евразия HD».

## Назначение

Приложение «Евразия HD» построено на Expo / React Native. Основной пользовательский экран находится в `app/(tabs)/index.tsx`; работа с API и локальным состоянием вынесена в `lib/`.

## Android

- package: `com.evrasia.hd`;
- Expo SDK 54 / React Native 0.81;
- Android minimum SDK: 24;
- production APK policy: arm64-only;
- release numbering: numeric GitHub tags `vN`;
- начиная со стандартизированного pipeline, `versionCode=N`, `versionName=vN`.

## Релизы

Каждый push в `main` запускает release workflow. Реальный Release создаётся исключительно для triggering commit, содержащего literal `[release]`.

Рабочие ветки вида `*-work` автоматически проходят тот же APK build/verify/signing path в режиме validation, но не публикуют production GitHub Release.

## Стандартная документация

- `ARCHITECTURE.md` — архитектурные границы и критические инварианты.
- `CHANGELOG.md` — накопительная release history.
- `RELEASE.md` — release contract проекта.
- `.release/latest.json` — каноническое machine-readable состояние последнего опубликованного релиза.
