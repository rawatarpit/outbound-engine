#!/usr/bin/env python3
"""
Scrape + extract — Crawl4AI scrape & crawl + NVIDIA LLM extraction + grounding + Bricks emails.

Input:  JSON via argv[1] or stdin
        {url, domain, llm_api_key, llm_base_url, llm_model}
Output: JSON to stdout (single line)
        {name, domain, source_url, summary, industry, tech_stack,
         employees, funding, revenue, key_people, emails,
         extraction_confidence, confidence_tier, crawl_pages,
         content_length, raw_content} or null
"""
import asyncio, json, sys, os, time, re, logging

from lib import stdout_to_stderr, log, verify_grounding, compute_confidence_tier
from lib import _REAL_STDOUT

async def crawl4ai_scrape(url: str, max_chars: int = 15000) -> dict:
    from crawl4ai import AsyncWebCrawler
    try:
        with stdout_to_stderr():
            async with AsyncWebCrawler(verbose=False) as c:
                r = await c.arun(url=url, log_level=logging.ERROR)
        return {
            "success": r.success,
            "title": (r.metadata or {}).get("title", ""),
            "markdown": (r.markdown or "")[:max_chars],
            "url": r.url,
        }
    except Exception as e:
        log(f"Crawl4AI scrape failed for {url}: {e}")
        return {"success": False, "title": "", "markdown": "", "url": url}

async def crawl4ai_crawl(domain: str, max_chars: int = 8000) -> list:
    from crawl4ai import AsyncWebCrawler
    pages = []
    paths = ["/team", "/about", "/company", "/leadership", "/people", "/careers"]
    with stdout_to_stderr():
        async with AsyncWebCrawler(verbose=False) as c:
            for path in paths:
                try:
                    r = await c.arun(url=f"https://{domain}{path}", log_level=logging.ERROR)
                    if r.success and r.markdown and len(r.markdown) > 100:
                        pages.append({
                            "url": r.url,
                            "content": r.markdown[:max_chars],
                        })
                except:
                    pass
    return pages

def llm_extract(content: str, domain: str, api_key: str = "",
                base_url: str = "https://integrate.api.nvidia.com/v1",
                model: str = "meta/llama-3.1-8b-instruct") -> dict:
    if not api_key:
        log("No LLM API key available — skipping extraction")
        return {}

    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=base_url)

    prompt = """You are a data extraction engine. You ONLY extract information that appears VERBATIM in the provided web content. If a field is NOT explicitly found in the content, return null. NEVER infer, guess, or use your training knowledge.

Extract from this scraped website content:

---CONTENT---
{content}
---END---

Return ONLY valid JSON (no markdown, no explanation):
{{
  "name": "company name or null",
  "industry": "primary industry or null",
  "description": "1-2 sentence description found verbatim on the page or null",
  "tech_stack": ["tech1", "tech2"] or null,
  "employees": "employee count hint or null",
  "funding": "funding info if mentioned or null",
  "key_people": [{{"name": "Full Name", "title": "Job Title"}}] or null
}}"""

    safe_content = content[:6000].replace("{", "{{").replace("}", "}}")
    full = prompt.format(content=safe_content)

    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": full}],
                temperature=0.1,
                max_tokens=600,
            )
            text = resp.choices[0].message.content.strip()
            if text.startswith("```"):
                text = re.sub(r'^```\w*\n?', '', text)
                text = re.sub(r'\n?```\s*$', '', text)
            return json.loads(text)
        except json.JSONDecodeError:
            log(f"LLM JSON decode failed (attempt {attempt + 1})")
        except Exception as e:
            log(f"LLM call failed (attempt {attempt + 1}): {e}")
            if attempt < 2:
                time.sleep(2 ** attempt * 5)
    return {}

def bricks_find_emails(company: str, domain: str) -> list:
    try:
        proc = subprocess.run(
            ["bricks", "email", "find", "--company", company, "--domain", domain],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            emails = json.loads(proc.stdout)
            if isinstance(emails, list):
                return emails
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"Bricks email find skipped: {e}")
    return []

import subprocess

async def main():
    if len(sys.argv) >= 2:
        params = json.loads(sys.argv[1])
    else:
        params = json.loads(sys.stdin.read())

    domain = params.get("domain", "")
    url = params.get("url", "") or f"https://{domain}"
    llm_api_key = params.get("llm_api_key", "")
    llm_base_url = params.get("llm_base_url", "https://integrate.api.nvidia.com/v1")
    llm_model = params.get("llm_model", "meta/llama-3.1-8b-instruct")

    if not domain:
        try:
            domain = url.split("/")[2].replace("www.", "")
        except:
            _REAL_STDOUT.write("null\n")
            _REAL_STDOUT.flush()
            return

    start = time.time()

    # Step 1: Scrape main page
    website = await crawl4ai_scrape(f"https://{domain}")
    if not website.get("success") or not website.get("markdown"):
        website = await crawl4ai_scrape(f"https://www.{domain}")
    content = website.get("markdown", "")

    if not content or len(content) < 50:
        _REAL_STDOUT.write("null\n")
        _REAL_STDOUT.flush()
        return

    # Step 2: Crawl sub-pages
    pages = await crawl4ai_crawl(domain)
    all_text = content + "\n\n".join(p.get("content", "") for p in pages)
    log(f"  {domain}: {len(content)} chars, {len(pages)} sub-pages")

    # Step 3: LLM extraction
    extraction = llm_extract(all_text, domain,
                             api_key=llm_api_key, base_url=llm_base_url, model=llm_model)

    # Step 4: Grounding
    grounded = verify_grounding(extraction, all_text)
    confidence = grounded["_confidence"]
    tier = compute_confidence_tier(confidence)
    log(f"  {domain}: confidence={confidence}, tier={tier}")

    # Step 5: Bricks emails
    name = grounded.get("name") or domain.split(".")[0].capitalize()
    emails = bricks_find_emails(name, domain)

    result = {
        "name": grounded.get("name") or name,
        "domain": domain,
        "source_url": website.get("url", url),
        "summary": (grounded.get("description") or "")[:500],
        "industry": grounded.get("industry") or None,
        "tech_stack": grounded.get("tech_stack") or [],
        "employees": grounded.get("employees") or None,
        "funding": grounded.get("funding") or None,
        "key_people": grounded.get("key_people") or [],
        "emails": emails or [],
        "extraction_confidence": confidence,
        "confidence_tier": tier,
        "crawl_pages": len(pages),
        "content_length": len(all_text),
        "raw_content": all_text[:2000],
        "_duration_ms": int((time.time() - start) * 1000),
    }

    _REAL_STDOUT.write(json.dumps(result) + "\n")
    _REAL_STDOUT.flush()

if __name__ == "__main__":
    asyncio.run(main())
