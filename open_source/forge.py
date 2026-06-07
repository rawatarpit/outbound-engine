#!/usr/bin/env python3
"""
FORGE enrichment for a single domain.

Input:  JSON via argv[1] or stdin
        {domain: str}
Output: JSON to stdout (single line)
        {industry, tech_stack, summary, employees, revenue, emails} or {} on failure
"""
import json, sys, os, csv, tempfile, subprocess, time

from lib import log
from lib import _REAL_STDOUT

def forge_enrich(domain: str) -> dict:
    try:
        with tempfile.TemporaryDirectory() as tmp:
            inp = os.path.join(tmp, "input.csv")
            out = os.path.join(tmp, "output.csv")
            with open(inp, "w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["name", "domain"])
                w.writerow(["", domain])
            proc = subprocess.run(
                ["forge", "enrich", "--file", inp, "--output", out,
                 "--mode", "ai", "--workers", "1", "--max", "1"],
                capture_output=True, text=True, timeout=120,
                env={**os.environ, "PATH": f"{os.path.expanduser('~')}/.local/bin:{os.environ.get('PATH', '')}"},
            )
            if os.path.exists(out):
                with open(out, newline="") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        return dict(row)
    except subprocess.TimeoutExpired:
        log(f"FORGE enrichment timed out for {domain}")
    except FileNotFoundError:
        log("FORGE not installed — skipping")
    except Exception as e:
        log(f"FORGE enrichment skipped for {domain}: {e}")
    return {}

def main():
    if len(sys.argv) >= 2:
        params = json.loads(sys.argv[1])
    else:
        params = json.loads(sys.stdin.read())

    domain = params.get("domain", "")
    if not domain:
        _REAL_STDOUT.write(json.dumps({}) + "\n")
        _REAL_STDOUT.flush()
        return

    start = time.time()
    result = forge_enrich(domain)
    result["_duration_ms"] = int((time.time() - start) * 1000)
    _REAL_STDOUT.write(json.dumps(result) + "\n")
    _REAL_STDOUT.flush()

if __name__ == "__main__":
    main()
