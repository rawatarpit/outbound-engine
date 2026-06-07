#!/usr/bin/env python3
"""
bricks — open-source email finder CLI.

Usage:
  bricks email find --company <name> --domain <domain>
  bricks email find --company "Acme Inc" --domain acme.com

Outputs JSON array of found email objects:
  [{"email":"...","confidence":0.6,"source":"pattern"}]
"""

import argparse
import json
import sys
import re
import subprocess
import dns.resolver
import requests
from urllib.parse import urlparse

NAME_EMAIL_RE = re.compile(
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-\s]*([\w._%+-]+@[\w.-]+\.\w{2,})"
)
EMAIL_RE = re.compile(r"[\w._%+-]+@[\w.-]+\.\w{2,}")


def domain_has_mx(domain: str) -> bool:
    try:
        mx = dns.resolver.resolve(domain, "MX")
        return len(mx) > 0
    except Exception:
        return False


def generate_patterns(first: str, last: str, domain: str) -> list[dict]:
    """Generate common email patterns from first/last name + domain."""
    f = first.lower().strip()
    l = last.lower().strip()
    d = domain.lower().strip()
    patterns = [
        f"{f}.{l}@{d}",
        f"{f}{l}@{d}",
        f"{f[0]}{l}@{d}",
        f"{f}@{d}",
    ]
    if f and l:
        patterns.append(f"{f}_{l}@{d}")
        patterns.append(f"{f}-{l}@{d}")
        patterns.append(f"{l}.{f}@{d}")

    results = []
    seen = set()
    for p in patterns:
        if p not in seen and "@" in p:
            seen.add(p)
            results.append({"email": p, "confidence": 0.35, "source": "pattern"})
    return results


def scrape_website(domain: str) -> list[dict]:
    """Scrape common team pages for emails."""
    paths = ["/about", "/team", "/company", "/leadership", "/about-us", "/people", "/our-team", "/contact"]
    found = []
    seen_email = set()

    for scheme in ["https"]:
        for base in [f"https://{domain}", f"https://www.{domain}"]:
            for path in paths:
                url = base + path
                try:
                    resp = requests.get(url, timeout=8, headers={
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                    })
                    if resp.status_code >= 500:
                        continue
                    text = resp.text

                    # Find name+email combos
                    for m in NAME_EMAIL_RE.finditer(text):
                        name = m.group(1).strip()
                        email = m.group(2).strip().lower()
                        if email.endswith(f"@{domain}") and email not in seen_email:
                            seen_email.add(email)
                            parts = name.split(" ")
                            found.append({
                                "email": email,
                                "first_name": parts[0] if parts else "",
                                "last_name": " ".join(parts[1:]) if len(parts) > 1 else "",
                                "full_name": name,
                                "confidence": 0.7,
                                "source": "website_scrape",
                                "url": url,
                            })

                    # Find standalone emails
                    for m in EMAIL_RE.finditer(text):
                        email = m.group(0).strip().lower()
                        if email.endswith(f"@{domain}") and email not in seen_email:
                            seen_email.add(email)
                            found.append({
                                "email": email,
                                "confidence": 0.5,
                                "source": "website_scrape",
                                "url": url,
                            })
                except Exception:
                    continue

    return found


def email_find(args) -> list[dict]:
    company = args.company or ""
    domain = args.domain or ""

    if not domain:
        return []

    results = []

    # 1. Website scrape
    scraped = scrape_website(domain)
    results.extend(scraped)
    seen = {r["email"] for r in results}

    # 2. Pattern generation from company name
    if company:
        parts = company.replace(" Inc", "").replace(" LLC", "").replace(" Ltd", "").replace(".", " ").split()
        for first in parts:
            for last in parts:
                if first != last:
                    for pat in generate_patterns(first, last, domain):
                        if pat["email"] not in seen:
                            seen.add(pat["email"])
                            results.append(pat)

    # 3. Check MX
    has_mx = domain_has_mx(domain)
    for r in results:
        r["domain_has_mx"] = has_mx
        if not has_mx:
            r["confidence"] = max(0.1, r["confidence"] - 0.2)

    return results


def main():
    parser = argparse.ArgumentParser(description="bricks — email finder CLI")
    sub = parser.add_subparsers(dest="command")

    email_parser = sub.add_parser("email")
    email_sub = email_parser.add_subparsers(dest="action")

    find_parser = email_sub.add_parser("find")
    find_parser.add_argument("--company", default="")
    find_parser.add_argument("--domain", default="")

    parsed = parser.parse_args()

    if parsed.command == "email" and parsed.action == "find":
        results = email_find(parsed)
        sys.stdout.write(json.dumps(results) + "\n")
        sys.stdout.flush()
    else:
        sys.stdout.write("[]\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
