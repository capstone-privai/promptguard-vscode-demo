"""Small stdin/stdout adapter around CredSweeper's rule/filter scanner.

Input text is accepted only over stdin. Output contains offsets and a one-way
fingerprint, never the detected value itself.
"""

from __future__ import annotations

import hashlib
import json
import sys
from typing import Any

from credsweeper import CredSweeper
from credsweeper.file_handler.string_content_provider import StringContentProvider


def secret_type(rule_name: str) -> str:
    name = rule_name.lower()
    if "private key" in name:
        return "PRIVATE_KEY"
    if "access key" in name:
        return "ACCESS_KEY"
    if "password" in name or "url credentials" in name:
        return "PASSWORD"
    if "bearer" in name or "token" in name:
        return "TOKEN"
    if "api" in name or name == "key":
        return "API_KEY"
    return "SECRET"


def line_starts(text: str) -> list[int]:
    starts = [0]
    for index, char in enumerate(text):
        if char == "\n":
            starts.append(index + 1)
    return starts


def scan(text: str, source: str) -> list[dict[str, Any]]:
    # Threshold 0 explicitly disables CredSweeper's ML validation path.
    scanner = CredSweeper(ml_threshold=0, use_filters=True, pool_count=1).scanner
    lines = text.splitlines()
    if text.endswith(("\n", "\r")):
        lines.append("")
    provider = StringContentProvider(lines or [""], file_path=source)
    starts = line_starts(text)
    detections: dict[tuple[int, int], dict[str, Any]] = {}

    for candidate in scanner.scan(provider):
        for item in candidate.line_data_list:
            line_index = item.line_num - 1
            if line_index < 0 or line_index >= len(starts):
                continue
            start = starts[line_index] + item.value_start
            end = starts[line_index] + item.value_end
            value = text[start:end]
            if not value or value != item.value:
                continue
            key = (start, end)
            normalized = {
                "type": secret_type(candidate.rule_name),
                "start": start,
                "end": end,
                "rule": candidate.rule_name,
                "fingerprint": hashlib.sha256(value.encode("utf-8")).hexdigest(),
            }
            # Multiple CredSweeper rules often identify the same value. Keep a
            # single span, preferring the more specific type over SECRET.
            current = detections.get(key)
            if current is None or current["type"] == "SECRET":
                detections[key] = normalized

    return sorted(detections.values(), key=lambda item: (item["start"], item["end"]))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        text = payload.get("text")
        source = payload.get("source", "prompt.txt")
        if not isinstance(text, str) or not isinstance(source, str):
            raise ValueError("invalid detector request")
        json.dump({"detections": scan(text, source)}, sys.stdout, separators=(",", ":"))
        return 0
    except Exception:
        # Fail without echoing exception details that might include input data.
        print("PromptGuard detector failed.", file=sys.stderr)
        return 70


if __name__ == "__main__":
    raise SystemExit(main())
