from __future__ import annotations

import csv
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


@dataclass(frozen=True)
class LexiconEntry:
    surface: str
    reading: str
    category: str = "custom"
    note: str = ""


def normalize_text(text: str) -> str:
    """Apply deterministic normalization without guessing Japanese readings."""
    normalized = unicodedata.normalize("NFKC", text).replace("\ufeff", "")
    return re.sub(r"\s+", " ", normalized).strip()


def discover_files(root: Path, extension: str) -> dict[str, Path]:
    if not root.is_dir():
        raise ValueError(f"Directory does not exist: {root}")

    suffix = extension if extension.startswith(".") else f".{extension}"
    files: dict[str, Path] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() != suffix.lower():
            continue
        key = path.relative_to(root).with_suffix("").as_posix()
        if key in files:
            raise ValueError(f"Duplicate relative filename without extension: {key}")
        files[key] = path.resolve()
    return files


def read_transcript(path: Path) -> str:
    return normalize_text(path.read_text(encoding="utf-8-sig"))


def load_lexicon(path: Path) -> list[LexiconEntry]:
    if not path.is_file():
        raise ValueError(f"Lexicon does not exist: {path}")

    entries: list[LexiconEntry] = []
    seen: dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        for line_number, row in enumerate(csv.reader(source, delimiter="\t"), 1):
            if not row or not row[0].strip() or row[0].lstrip().startswith("#"):
                continue
            if len(row) < 2:
                raise ValueError(
                    f"{path}:{line_number}: expected surface and reading columns"
                )

            surface = normalize_text(row[0])
            reading = normalize_text(row[1])
            category = normalize_text(row[2]) if len(row) > 2 else "custom"
            note = normalize_text(row[3]) if len(row) > 3 else ""
            if not surface or not reading:
                raise ValueError(
                    f"{path}:{line_number}: surface and reading must not be empty"
                )
            previous = seen.get(surface)
            if previous is not None:
                raise ValueError(
                    f"{path}:{line_number}: duplicate surface {surface!r}; "
                    f"first reading was {previous!r}"
                )
            seen[surface] = reading
            entries.append(LexiconEntry(surface, reading, category, note))
    return entries


def write_lexicon(path: Path, entries: Sequence[LexiconEntry]) -> None:
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["# surface", "reading", "category", "note"])
        for entry in entries:
            writer.writerow(
                [entry.surface, entry.reading, entry.category, entry.note]
            )


class PronunciationLexicon:
    def __init__(self, entries: Sequence[LexiconEntry]) -> None:
        self.entries = tuple(entries)
        self._readings = {entry.surface: entry.reading for entry in entries}
        surfaces = sorted(self._readings, key=lambda value: (-len(value), value))
        self._pattern = (
            re.compile("|".join(re.escape(surface) for surface in surfaces))
            if surfaces
            else None
        )

    @property
    def surfaces(self) -> frozenset[str]:
        return frozenset(self._readings)

    def apply(self, text: str) -> tuple[str, tuple[str, ...]]:
        normalized = normalize_text(text)
        if self._pattern is None:
            return normalized, ()

        matched: list[str] = []

        def replace(match: re.Match[str]) -> str:
            surface = match.group(0)
            matched.append(surface)
            return self._readings[surface]

        return self._pattern.sub(replace, normalized), tuple(matched)


_CANDIDATE_PATTERNS = (
    re.compile(r"[A-Za-z][A-Za-z0-9._+\-]*(?: +[A-Za-z0-9._+\-]+)*"),
    re.compile(r"[A-Za-z0-9]+[ァ-ヶー]+"),
    re.compile(r"[ァ-ヶー]+[A-Za-z0-9][A-Za-z0-9ァ-ヶー]*"),
    re.compile(r"(?<![A-Za-z0-9])[0-9]{2,}(?![A-Za-z0-9])"),
    re.compile(r"[ァ-ヶー]{2,}(?:・[ァ-ヶー]{2,})+"),
)


def find_lexicon_candidates(texts: Iterable[str]) -> Counter[str]:
    candidates: Counter[str] = Counter()
    for raw_text in texts:
        text = normalize_text(raw_text)
        found: set[str] = set()
        for pattern in _CANDIDATE_PATTERNS:
            found.update(match.group(0).strip() for match in pattern.finditer(text))
        candidates.update(value for value in found if value)
    return candidates
