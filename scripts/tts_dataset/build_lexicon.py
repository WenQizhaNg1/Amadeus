#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path

from dataset_common import (
    PronunciationLexicon,
    discover_files,
    find_lexicon_candidates,
    load_lexicon,
    read_transcript,
    write_lexicon,
)


DEFAULT_LEXICON = Path(__file__).with_name("steins_gate_lexicon.tsv")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a reviewable Steins;Gate pronunciation lexicon."
    )
    parser.add_argument("--text-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--text-extension", default=".txt")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def require_writable(paths: list[Path], overwrite: bool) -> None:
    existing = [path for path in paths if path.exists()]
    if existing and not overwrite:
        names = ", ".join(str(path) for path in existing)
        raise ValueError(f"Output already exists; pass --overwrite to replace: {names}")


def main() -> None:
    args = parse_args()
    text_files = discover_files(args.text_dir.resolve(), args.text_extension)
    if not text_files:
        raise ValueError("No transcript files were found.")

    entries = load_lexicon(args.base_lexicon.resolve())
    lexicon = PronunciationLexicon(entries)
    texts = [read_transcript(path) for path in text_files.values()]

    usage: Counter[str] = Counter()
    for text in texts:
        _, matched = lexicon.apply(text)
        usage.update(matched)

    candidates = find_lexicon_candidates(texts)
    for surface in lexicon.surfaces:
        candidates.pop(surface, None)

    output_dir = args.output_dir.resolve()
    lexicon_path = output_dir / "lexicon.tsv"
    usage_path = output_dir / "lexicon_usage.tsv"
    candidates_path = output_dir / "lexicon_candidates.tsv"
    require_writable(
        [lexicon_path, usage_path, candidates_path], args.overwrite
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    write_lexicon(lexicon_path, entries)
    with usage_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["surface", "reading", "count", "category", "note"])
        for entry in entries:
            writer.writerow(
                [
                    entry.surface,
                    entry.reading,
                    usage[entry.surface],
                    entry.category,
                    entry.note,
                ]
            )

    with candidates_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["surface", "count", "reading", "note"])
        for surface, count in sorted(
            candidates.items(), key=lambda item: (-item[1], item[0])
        ):
            writer.writerow([surface, count, "", "人工确认读音后加入 lexicon.tsv"])

    print(f"Transcripts: {len(texts)}")
    print(f"Seed entries: {len(entries)}")
    print(f"Matched seed entries: {sum(1 for count in usage.values() if count)}")
    print(f"Candidates requiring review: {len(candidates)}")
    print(f"Output: {output_dir}")


if __name__ == "__main__":
    main()
