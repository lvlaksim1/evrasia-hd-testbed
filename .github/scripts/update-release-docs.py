#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

START = "<!-- AUTO-RELEASE-START -->"
END = "<!-- AUTO-RELEASE-END -->"
CHANGELOG_INSERT = "<!-- AUTO-CHANGELOG-INSERT -->"
GENERATED_DOCS = {
    "README.md",
    "ARCHITECTURE.md",
    "CHANGELOG.md",
    "RELEASE.md",
    "REFACTORING.md",
    ".release/latest.json",
}


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def replace_block(path: Path, body: str) -> None:
    text = path.read_text(encoding="utf-8")
    block = f"{START}\n{body.rstrip()}\n{END}"
    if START in text and END in text:
        pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
        text = pattern.sub(block, text, count=1)
    else:
        lines = text.splitlines()
        insert_at = 1 if lines and lines[0].startswith("# ") else 0
        lines[insert_at:insert_at] = ["", block, ""]
        text = "\n".join(lines).rstrip() + "\n"
    path.write_text(text, encoding="utf-8")


def ensure_refactoring_document(path: Path) -> None:
    if path.exists():
        return
    path.write_text(
        f"# Рефакторинг {path.parent.name}\n\n"
        "Автоматическая контрольная точка текущего состояния рефакторинга. "
        "Детальные архитектурные инварианты описаны в `ARCHITECTURE.md`.\n",
        encoding="utf-8",
    )


def upsert_changelog(path: Path, tag: str, body: str) -> None:
    text = path.read_text(encoding="utf-8")
    start = f"<!-- AUTO-CHANGELOG-{tag}-START -->"
    end = f"<!-- AUTO-CHANGELOG-{tag}-END -->"
    section = f"{start}\n{body.rstrip()}\n{end}"
    if start in text and end in text:
        pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
        text = pattern.sub(section, text, count=1)
    else:
        if CHANGELOG_INSERT not in text:
            raise SystemExit("CHANGELOG.md does not contain AUTO-CHANGELOG-INSERT")
        text = text.replace(CHANGELOG_INSERT, f"{CHANGELOG_INSERT}\n{section}", 1)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def numeric_tags() -> list[tuple[int, str]]:
    tags = []
    for tag in run("git", "tag", "--list", "v[0-9]*").splitlines():
        match = re.fullmatch(r"v([0-9]+)", tag.strip())
        if match:
            tags.append((int(match.group(1)), tag.strip()))
    return sorted(tags)


def previous_tag(current_number: int) -> str:
    candidates = [tag for number, tag in numeric_tags() if number < current_number]
    return candidates[-1] if candidates else ""


def release_changes(previous: str, commit: str) -> tuple[list[str], list[str]]:
    commit_range = f"{previous}..{commit}" if previous else commit
    subjects = run("git", "log", "--reverse", "--format=%s", commit_range).splitlines()
    subjects = [
        subject for subject in subjects
        if subject.strip() and not subject.lower().startswith("docs: update release documentation")
    ]
    if previous:
        files = run("git", "diff", "--name-only", previous, commit).splitlines()
    else:
        files = run("git", "show", "--pretty=", "--name-only", commit).splitlines()
    files = [f for f in files if f and f not in GENERATED_DOCS]
    return subjects, sorted(dict.fromkeys(files))


def bullet_lines(items: list[str], empty: str, code: bool = False) -> str:
    if not items:
        return f"- {empty}"
    if code:
        return "\n".join(f"- `{item}`" for item in items)
    return "\n".join(f"- {item}" for item in items)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--release-commit", required=True)
    parser.add_argument("--artifact-filename", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--published-at", default="")
    parser.add_argument("--package-id", default="")
    parser.add_argument("--version-code", default="")
    parser.add_argument("--version-name", default="")
    args = parser.parse_args()

    match = re.fullmatch(r"v([0-9]+)", args.release_tag)
    if not match:
        raise SystemExit(f"Invalid release tag: {args.release_tag}")
    release_number = int(match.group(1))
    if not re.fullmatch(r"[0-9a-fA-F]{40}", args.release_commit):
        raise SystemExit("Invalid release commit")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", args.sha256):
        raise SystemExit("Invalid SHA-256")

    version_code = None
    if args.version_code:
        if not re.fullmatch(r"[0-9]+", args.version_code):
            raise SystemExit("Invalid versionCode")
        version_code = int(args.version_code)
    version_name = args.version_name or None
    package_id = args.package_id or None

    root = Path(__file__).resolve().parents[2]
    previous = previous_tag(release_number)
    subjects, changed_files = release_changes(previous, args.release_commit)
    repo = os.environ.get("GITHUB_REPOSITORY", f"lvlaksim1/{root.name}")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    release_url = f"{server}/{repo}/releases/tag/{args.release_tag}"
    artifact_url = f"{server}/{repo}/releases/download/{args.release_tag}/{args.artifact_filename}"
    previous_text = previous or "—"
    published = args.published_at or "—"

    readme_lines = [
        "## Текущий релиз",
        "",
        f"- Версия: **{args.release_tag}**",
    ]
    if version_code is not None:
        readme_lines.append(f"- `versionCode`: **{version_code}**")
    if version_name is not None:
        readme_lines.append(f"- `versionName`: **{version_name}**")
    if package_id is not None:
        readme_lines.append(f"- package: `{package_id}`")
    readme_lines.extend([
        f"- commit: `{args.release_commit}`",
        f"- APK: `{args.artifact_filename}`",
        f"- SHA-256: `{args.sha256}`",
        f"- Опубликован: `{published}`",
        f"- Предыдущий релиз: **{previous_text}**",
        f"- Release: {release_url}",
        f"- APK: {artifact_url}",
    ])

    architecture_block = f"""## Контрольная точка документа

- Актуально для релиза: **{args.release_tag}**
- Релизный commit: `{args.release_commit}`
- Опубликован: `{published}`"""

    release_block = f"""## Последний проверенный релиз

- Релиз: **{args.release_tag}**
- Релизный commit: `{args.release_commit}`
- Артефакт: `{args.artifact_filename}`
- SHA-256: `{args.sha256}`
- Опубликован: `{published}`"""

    refactoring_block = f"""## Контрольная точка рефакторинга

- Актуально для релиза: **{args.release_tag}**
- Релизный commit: `{args.release_commit}`
- Опубликован: `{published}`

### Изменения между релизами

{bullet_lines(subjects, "Отдельных изменений между релизами не зафиксировано.")}

### Изменённые файлы

{bullet_lines(changed_files, "Нет файловых изменений.", code=True)}"""

    changelog_block = f"""## {args.release_tag} — {published}

- Release commit: `{args.release_commit}`
- Artifact: `{args.artifact_filename}`
- SHA-256: `{args.sha256}`
- Previous release: **{previous_text}**

### Changes

{bullet_lines(subjects, "Отдельных изменений между релизами не зафиксировано.")}

### Changed files

{bullet_lines(changed_files, "Нет файловых изменений.", code=True)}"""

    manifest = {
        "schemaVersion": 1,
        "releaseNumber": release_number,
        "tag": args.release_tag,
        "versionCode": version_code,
        "versionName": version_name,
        "packageId": package_id,
        "commit": args.release_commit,
        "artifact": args.artifact_filename,
        "sha256": args.sha256.lower(),
        "publishedAt": args.published_at or None,
        "previousRelease": previous or None,
        "releaseUrl": release_url,
        "artifactUrl": artifact_url,
        "commits": subjects,
        "changedFiles": changed_files,
    }

    refactoring_path = root / "REFACTORING.md"
    ensure_refactoring_document(refactoring_path)
    replace_block(root / "README.md", "\n".join(readme_lines))
    replace_block(root / "ARCHITECTURE.md", architecture_block)
    replace_block(root / "RELEASE.md", release_block)
    replace_block(refactoring_path, refactoring_block)
    upsert_changelog(root / "CHANGELOG.md", args.release_tag, changelog_block)

    manifest_path = root / ".release" / "latest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
