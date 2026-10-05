"""Evaluate the current VS Code Demo privacy path with the shared metric-1 scorer.

This adapter deliberately calls this repository's detector_adapter.scan instead
of reimplementing CredSweeper span handling. The external evaluation repository
provides only dataset validation, scoring, and report generation.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = REPO_ROOT.parent / "promptguard-data" / "metric-1" / "sessions.jsonl"
DEFAULT_EVALUATOR = REPO_ROOT.parent / "promptguard-demo-v0-eval"
DEFAULT_OUT = REPO_ROOT / "evaluation-runs"
PROCESSED_CHANNELS = ("prompt", "stdout", "stderr", "file_read")


def git_commit(root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        capture_output=True,
        check=False,
        text=True,
    )
    return result.stdout.strip()[:12] if result.returncode == 0 else "unknown"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate PromptGuard VS Code Demo on metric-1")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--evaluation-repo", type=Path, default=DEFAULT_EVALUATOR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    evaluation_repo = args.evaluation_repo.resolve()
    if not (evaluation_repo / "evaluation" / "run.py").is_file():
        print("evaluation repository is missing or incompatible", file=sys.stderr)
        return 3
    sys.path.insert(0, str(evaluation_repo))
    sys.path.insert(0, str(REPO_ROOT / "python"))

    from detector_adapter import scan
    from evaluation.adapters.base import ItemOutput, passthrough
    from evaluation.cli import execute_run
    from evaluation.scorer.edits import Edit, apply_edits

    class VscodeDemoAdapter:
        name = "promptguard-vscode"

        def describe(self) -> dict[str, Any]:
            return {
                "system": self.name,
                "detector": "credsweeper-ml-off",
                "channels": list(PROCESSED_CHANNELS),
                "redaction": "value-only-session-placeholders",
                "demo_commit": git_commit(REPO_ROOT),
            }

        def run_session(self, session: Any) -> dict[str, ItemOutput]:
            outputs: dict[str, ItemOutput] = {}
            counters: defaultdict[str, int] = defaultdict(int)
            placeholders: dict[str, str] = {}
            for item in session.items:
                if item.channel not in PROCESSED_CHANNELS:
                    outputs[item.item_id] = passthrough(item.item_id, item.text)
                    continue
                started = time.perf_counter()
                detected = scan(item.text, f"evaluation-{item.channel}.txt")
                accepted: list[dict[str, Any]] = []
                last_end = -1
                for detection in sorted(detected, key=lambda value: (value["start"], -value["end"])):
                    if detection["start"] >= last_end:
                        accepted.append(detection)
                        last_end = detection["end"]
                edits: list[Edit] = []
                for detection in accepted:
                    key = f'{detection["type"]}:{detection["fingerprint"]}'
                    if key not in placeholders:
                        counters[detection["type"]] += 1
                        placeholders[key] = f'[{detection["type"]}_{counters[detection["type"]]}]'
                    edits.append(Edit(detection["start"], detection["end"], placeholders[key]))
                text = apply_edits(item.text, edits)
                elapsed_ms = (time.perf_counter() - started) * 1000
                outputs[item.item_id] = ItemOutput(item.item_id, text, edits, elapsed_ms)
            return outputs

    return execute_run(
        str(args.dataset.resolve()),
        lambda _threshold: VscodeDemoAdapter(),
        label="promptguard-vscode",
        out_root=args.out.resolve(),
    )


if __name__ == "__main__":
    raise SystemExit(main())
