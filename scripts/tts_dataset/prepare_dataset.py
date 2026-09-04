#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import wave
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

from dataset_common import (
    PronunciationLexicon,
    discover_files,
    find_lexicon_candidates,
    load_lexicon,
    read_transcript,
    write_lexicon,
)


TARGET_SAMPLE_RATE = 24_000
TARGET_CHANNELS = 1
TARGET_SAMPLE_WIDTH = 2
DEFAULT_INSTRUCT = "You are a helpful assistant.<|endofprompt|>"
DEFAULT_LEXICON = Path(__file__).with_name("steins_gate_lexicon.tsv")
SPLITS = ("train", "dev", "test")


@dataclass(frozen=True)
class AudioInfo:
    duration_seconds: float
    sample_rate: int
    channels: int
    codec: str
    bits_per_sample: int | None


@dataclass
class Record:
    id: str
    speaker: str
    language: str
    source_key: str
    source_wav: str
    source_text: str
    output_wav: str
    text_original: str = ""
    text_tts: str = ""
    duration_seconds: float | None = None
    sample_rate: int | None = None
    channels: int | None = None
    codec: str | None = None
    bits_per_sample: int | None = None
    matched_terms: list[str] = field(default_factory=list)
    split: str | None = None
    rejection_reasons: list[str] = field(default_factory=list)


def parse_args() -> argparse.Namespace:
    default_jobs = max(1, min(4, os.cpu_count() or 1))
    parser = argparse.ArgumentParser(
        description=(
            "Audit paired WAV/TXT files, convert accepted audio, split the "
            "dataset, and emit CosyVoice 3 manifests."
        )
    )
    parser.add_argument("--audio-dir", type=Path, required=True)
    parser.add_argument("--text-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--text-extension", default=".txt")
    parser.add_argument("--speaker", default="amadeus")
    parser.add_argument("--language", default="ja")
    parser.add_argument("--min-duration", type=float, default=1.0)
    parser.add_argument("--max-duration", type=float, default=30.0)
    parser.add_argument("--train-ratio", type=float, default=0.90)
    parser.add_argument("--dev-ratio", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=1986)
    parser.add_argument("--jobs", type=int, default=default_jobs)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--instruct", default=DEFAULT_INSTRUCT)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if args.min_duration <= 0:
        raise ValueError("--min-duration must be greater than zero.")
    if args.max_duration <= args.min_duration:
        raise ValueError("--max-duration must be greater than --min-duration.")
    if args.train_ratio <= 0 or args.dev_ratio <= 0:
        raise ValueError("Train and dev ratios must be greater than zero.")
    if args.train_ratio + args.dev_ratio >= 1:
        raise ValueError("Train and dev ratios must leave a positive test ratio.")
    if args.jobs <= 0:
        raise ValueError("--jobs must be greater than zero.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", args.speaker):
        raise ValueError(
            "--speaker must contain only ASCII letters, digits, dot, underscore, or dash."
        )
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", args.language):
        raise ValueError("--language must be a short language identifier such as ja.")
    if not args.instruct.strip():
        raise ValueError("--instruct must not be empty.")
    for executable in (args.ffmpeg, args.ffprobe):
        if shutil.which(executable) is None:
            raise ValueError(f"Required executable was not found: {executable}")


def ensure_output_directory(path: Path, overwrite: bool) -> None:
    if path.exists() and not path.is_dir():
        raise ValueError(f"Output path is not a directory: {path}")
    if path.exists() and any(path.iterdir()) and not overwrite:
        raise ValueError(
            f"Output directory is not empty: {path}. "
            "Use a new directory or pass --overwrite."
        )
    path.mkdir(parents=True, exist_ok=True)


def validate_paths(audio_dir: Path, text_dir: Path, output_dir: Path) -> None:
    if any(character.isspace() for character in str(output_dir)):
        raise ValueError(
            "--output-dir must not contain whitespace because CosyVoice wav.scp "
            "uses whitespace as a field separator."
        )
    if output_dir.is_relative_to(audio_dir) or output_dir.is_relative_to(text_dir):
        raise ValueError("--output-dir must be outside the input directories.")


def pair_inputs(
    audio_dir: Path, text_dir: Path, text_extension: str
) -> list[tuple[str, Path, Path]]:
    audio_files = discover_files(audio_dir, ".wav")
    text_files = discover_files(text_dir, text_extension)
    missing_text = sorted(audio_files.keys() - text_files.keys())
    missing_audio = sorted(text_files.keys() - audio_files.keys())
    if missing_text or missing_audio:
        messages = []
        if missing_text:
            messages.append(
                "WAV files without transcripts: " + ", ".join(missing_text[:20])
            )
        if missing_audio:
            messages.append(
                "Transcripts without WAV files: " + ", ".join(missing_audio[:20])
            )
        raise ValueError("\n".join(messages))
    if not audio_files:
        raise ValueError("No paired WAV files were found.")
    return [
        (key, audio_files[key], text_files[key]) for key in sorted(audio_files)
    ]


def parse_positive_float(value: object) -> float | None:
    try:
        parsed = float(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def probe_audio(path: Path, ffprobe: str) -> AudioInfo:
    command = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,bits_per_sample,duration:format=duration",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", timeout=30
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or "ffprobe returned no error message"
        raise ValueError(detail)

    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    if not streams:
        raise ValueError("no audio stream")
    stream = streams[0]
    duration = parse_positive_float(stream.get("duration"))
    if duration is None:
        duration = parse_positive_float(payload.get("format", {}).get("duration"))
    if duration is None:
        raise ValueError("duration is missing or invalid")

    sample_rate = int(stream.get("sample_rate", 0))
    channels = int(stream.get("channels", 0))
    if sample_rate <= 0 or channels <= 0:
        raise ValueError("sample rate or channel count is invalid")
    try:
        bits = int(stream.get("bits_per_sample", 0)) or None
    except (TypeError, ValueError):
        bits = None
    return AudioInfo(
        duration_seconds=duration,
        sample_rate=sample_rate,
        channels=channels,
        codec=str(stream.get("codec_name", "unknown")),
        bits_per_sample=bits,
    )


def convert_audio(source: Path, destination: Path, ffmpeg: str) -> None:
    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-map",
        "0:a:0",
        "-map_metadata",
        "-1",
        "-vn",
        "-ac",
        str(TARGET_CHANNELS),
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        str(destination),
    ]
    result = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", timeout=120
    )
    if result.returncode != 0:
        destination.unlink(missing_ok=True)
        detail = result.stderr.strip() or "ffmpeg returned no error message"
        raise ValueError(detail)


def validate_converted_wave(path: Path) -> None:
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != TARGET_CHANNELS:
            raise ValueError("converted WAV is not mono")
        if audio.getframerate() != TARGET_SAMPLE_RATE:
            raise ValueError("converted WAV is not 24 kHz")
        if audio.getsampwidth() != TARGET_SAMPLE_WIDTH:
            raise ValueError("converted WAV is not 16-bit PCM")
        if audio.getcomptype() != "NONE":
            raise ValueError("converted WAV is compressed")


def stable_id(speaker: str, source_key: str) -> str:
    digest = hashlib.sha1(source_key.encode("utf-8")).hexdigest()[:12]
    return f"{speaker}_{digest}"


def process_pair(
    pair: tuple[str, Path, Path],
    *,
    output_wav_dir: Path,
    lexicon: PronunciationLexicon,
    speaker: str,
    language: str,
    min_duration: float,
    max_duration: float,
    ffmpeg: str,
    ffprobe: str,
) -> Record:
    source_key, source_wav, source_text = pair
    utterance_id = stable_id(speaker, source_key)
    output_wav = output_wav_dir / f"{utterance_id}.wav"
    record = Record(
        id=utterance_id,
        speaker=speaker,
        language=language,
        source_key=source_key,
        source_wav=str(source_wav),
        source_text=str(source_text),
        output_wav=str(output_wav.resolve()),
    )
    output_wav.unlink(missing_ok=True)

    try:
        record.text_original = read_transcript(source_text)
        record.text_tts, matched = lexicon.apply(record.text_original)
        record.matched_terms = list(matched)
    except (OSError, UnicodeError, ValueError) as error:
        record.rejection_reasons.append(f"invalid_transcript: {error}")

    try:
        info = probe_audio(source_wav, ffprobe)
        record.duration_seconds = info.duration_seconds
        record.sample_rate = info.sample_rate
        record.channels = info.channels
        record.codec = info.codec
        record.bits_per_sample = info.bits_per_sample
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError) as error:
        record.rejection_reasons.append(f"invalid_audio: {error}")

    if not record.text_tts:
        record.rejection_reasons.append("empty_transcript")
    if record.duration_seconds is not None:
        if record.duration_seconds < min_duration:
            record.rejection_reasons.append(
                f"too_short: {record.duration_seconds:.3f}s < {min_duration:.3f}s"
            )
        elif record.duration_seconds > max_duration:
            record.rejection_reasons.append(
                f"too_long: {record.duration_seconds:.3f}s > {max_duration:.3f}s"
            )
    if record.sample_rate is not None and record.sample_rate < 16_000:
        record.rejection_reasons.append(
            f"sample_rate_below_16khz: {record.sample_rate}"
        )

    if record.rejection_reasons:
        return record

    try:
        convert_audio(source_wav, output_wav, ffmpeg)
        validate_converted_wave(output_wav)
    except (OSError, subprocess.SubprocessError, ValueError, wave.Error) as error:
        output_wav.unlink(missing_ok=True)
        record.rejection_reasons.append(f"conversion_failed: {error}")
    return record


def split_records(
    records: Sequence[Record], train_ratio: float, dev_ratio: float, seed: int
) -> dict[str, list[Record]]:
    groups: dict[str, list[Record]] = defaultdict(list)
    for record in records:
        groups[record.text_tts].append(record)
    if len(groups) < len(SPLITS):
        raise ValueError(
            "Fewer than three unique normalized transcripts passed validation."
        )

    grouped_records = [
        sorted(group, key=lambda record: record.id) for group in groups.values()
    ]
    random.Random(seed).shuffle(grouped_records)
    total = len(records)
    targets = {
        "train": total * train_ratio,
        "dev": total * dev_ratio,
        "test": total * (1 - train_ratio - dev_ratio),
    }
    result: dict[str, list[Record]] = {split: [] for split in SPLITS}

    for group in grouped_records:
        split = min(
            SPLITS,
            key=lambda name: len(result[name]) / targets[name],
        )
        for record in group:
            record.split = split
        result[split].extend(group)

    for split in SPLITS:
        result[split].sort(key=lambda record: record.id)
    return result


def write_lines(path: Path, lines: Iterable[str]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as output:
        for line in lines:
            output.write(f"{line}\n")


def write_jsonl(path: Path, records: Iterable[Record]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as output:
        for record in records:
            output.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")


def write_cosyvoice_split(
    root: Path, split: str, records: Sequence[Record], speaker: str, instruct: str
) -> None:
    split_dir = root / split
    split_dir.mkdir(parents=True, exist_ok=True)
    write_lines(
        split_dir / "wav.scp",
        (f"{record.id} {record.output_wav}" for record in records),
    )
    write_lines(
        split_dir / "text",
        (f"{record.id} {record.text_tts}" for record in records),
    )
    write_lines(
        split_dir / "utt2spk", (f"{record.id} {speaker}" for record in records)
    )
    write_lines(
        split_dir / "spk2utt",
        (
            [f"{speaker} {' '.join(record.id for record in records)}"]
            if records
            else []
        ),
    )
    write_lines(
        split_dir / "instruct",
        (f"{record.id} {instruct}" for record in records),
    )


def duration_summary(records: Sequence[Record]) -> dict[str, float | int | None]:
    durations = [
        record.duration_seconds
        for record in records
        if record.duration_seconds is not None
    ]
    if not durations:
        return {
            "utterances": len(records),
            "total_seconds": 0.0,
            "mean_seconds": None,
            "min_seconds": None,
            "max_seconds": None,
        }
    return {
        "utterances": len(records),
        "total_seconds": round(sum(durations), 3),
        "mean_seconds": round(sum(durations) / len(durations), 3),
        "min_seconds": round(min(durations), 3),
        "max_seconds": round(max(durations), 3),
    }


def counter_dict(values: Iterable[object]) -> dict[str, int]:
    return dict(sorted(Counter(str(value) for value in values).items()))


def write_reports(
    output_dir: Path,
    records: Sequence[Record],
    splits: dict[str, list[Record]],
    lexicon: PronunciationLexicon,
    settings: dict[str, object],
) -> None:
    accepted = [record for record in records if not record.rejection_reasons]
    rejected = [record for record in records if record.rejection_reasons]
    rejection_reasons = Counter(
        reason.split(":", 1)[0]
        for record in rejected
        for reason in record.rejection_reasons
    )
    lexicon_matches = Counter(
        term for record in accepted for term in record.matched_terms
    )

    report = {
        "settings": settings,
        "input": duration_summary(records),
        "accepted": duration_summary(accepted),
        "rejected": len(rejected),
        "rejection_reasons": dict(sorted(rejection_reasons.items())),
        "input_formats": {
            "sample_rates": counter_dict(
                record.sample_rate
                for record in records
                if record.sample_rate is not None
            ),
            "channels": counter_dict(
                record.channels for record in records if record.channels is not None
            ),
            "codecs": counter_dict(
                record.codec for record in records if record.codec is not None
            ),
            "bits_per_sample": counter_dict(
                record.bits_per_sample
                for record in records
                if record.bits_per_sample is not None
            ),
        },
        "splits": {
            split: duration_summary(split_records) for split, split_records in splits.items()
        },
        "lexicon_matches": dict(sorted(lexicon_matches.items())),
    }
    (output_dir / "audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_jsonl(output_dir / "metadata.jsonl", accepted)
    write_jsonl(output_dir / "rejected.jsonl", rejected)
    write_lexicon(output_dir / "lexicon.tsv", lexicon.entries)

    with (output_dir / "lexicon_usage.tsv").open(
        "w", encoding="utf-8", newline=""
    ) as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["surface", "count"])
        for surface, count in sorted(
            lexicon_matches.items(), key=lambda item: (-item[1], item[0])
        ):
            writer.writerow([surface, count])

    candidates = find_lexicon_candidates(
        record.text_original for record in accepted
    )
    for surface in lexicon.surfaces:
        candidates.pop(surface, None)
    with (output_dir / "lexicon_candidates.tsv").open(
        "w", encoding="utf-8", newline=""
    ) as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["surface", "count", "reading", "note"])
        for surface, count in sorted(
            candidates.items(), key=lambda item: (-item[1], item[0])
        ):
            writer.writerow([surface, count, "", "人工确认读音"])


def main() -> None:
    args = parse_args()
    validate_args(args)
    audio_dir = args.audio_dir.resolve()
    text_dir = args.text_dir.resolve()
    output_dir = args.output_dir.resolve()
    validate_paths(audio_dir, text_dir, output_dir)
    pairs = pair_inputs(audio_dir, text_dir, args.text_extension)
    entries = load_lexicon(args.lexicon.resolve())
    lexicon = PronunciationLexicon(entries)
    ensure_output_directory(output_dir, args.overwrite)
    output_wav_dir = output_dir / "wav24k"
    output_wav_dir.mkdir(parents=True, exist_ok=True)

    def process(pair: tuple[str, Path, Path]) -> Record:
        return process_pair(
            pair,
            output_wav_dir=output_wav_dir,
            lexicon=lexicon,
            speaker=args.speaker,
            language=args.language,
            min_duration=args.min_duration,
            max_duration=args.max_duration,
            ffmpeg=args.ffmpeg,
            ffprobe=args.ffprobe,
        )

    records: list[Record] = []
    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        for index, record in enumerate(executor.map(process, pairs), 1):
            records.append(record)
            if index % 100 == 0 or index == len(pairs):
                print(f"Processed {index}/{len(pairs)}")

    accepted = [record for record in records if not record.rejection_reasons]
    if len(accepted) < 3:
        raise ValueError("Fewer than three utterances passed validation.")
    splits = split_records(
        accepted, args.train_ratio, args.dev_ratio, args.seed
    )

    cosyvoice_root = output_dir / "cosyvoice3"
    for split in SPLITS:
        write_cosyvoice_split(
            cosyvoice_root,
            split,
            splits[split],
            args.speaker,
            args.instruct.strip(),
        )

    settings = {
        "audio_dir": str(audio_dir),
        "text_dir": str(text_dir),
        "lexicon": str(args.lexicon.resolve()),
        "speaker": args.speaker,
        "language": args.language,
        "min_duration_seconds": args.min_duration,
        "max_duration_seconds": args.max_duration,
        "target_sample_rate": TARGET_SAMPLE_RATE,
        "target_channels": TARGET_CHANNELS,
        "target_codec": "pcm_s16le",
        "train_ratio": args.train_ratio,
        "dev_ratio": args.dev_ratio,
        "test_ratio": 1 - args.train_ratio - args.dev_ratio,
        "seed": args.seed,
        "instruct": args.instruct.strip(),
    }
    write_reports(output_dir, records, splits, lexicon, settings)

    rejected_count = len(records) - len(accepted)
    print(f"Accepted: {len(accepted)}")
    print(f"Rejected: {rejected_count}")
    print(
        "Splits: "
        + ", ".join(f"{split}={len(splits[split])}" for split in SPLITS)
    )
    print(f"Output: {output_dir}")


if __name__ == "__main__":
    main()
