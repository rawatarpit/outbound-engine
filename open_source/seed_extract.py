#!/usr/bin/env python3
"""
Seed extraction — LLM reads content like an analyst to understand the signal:
who is talking, what is their pain, and how to find more people like them.

Input:  JSON via argv[1] or stdin
        {content, source_domain, brand_context, llm_api_key, llm_base_url, llm_model}
        brand_context: {brand_name, product, audience, core_offer, positioning}
Output: JSON to stdout (single line)
        {context_summary, author: {name, role, company},
         pain_points: [str], signals: [{type, description}],
         queries: [{text, signal}],
         leads: [{name, domain_hint, reason}]}
"""
import json, sys, os, time, re

from lib import _REAL_STDOUT, log

def _fix_json_unescaped(s: str) -> str:
    """Escape unescaped double quotes inside JSON string values."""
    result = []
    in_string = False
    escaped = False
    for i, ch in enumerate(s):
        if escaped:
            result.append(ch)
            escaped = False
            continue
        if ch == '\\':
            result.append(ch)
            escaped = True
            continue
        if ch == '"':
            if in_string:
                # Look ahead to determine if this is a closing delimiter
                rest = s[i+1:].lstrip()
                if rest and rest[0] in ',:]}':
                    # This IS the closing delimiter
                    in_string = False
                    result.append(ch)
                else:
                    # This is an unescaped quote inside the string — escape it
                    result.append('\\"')
            else:
                in_string = True
                result.append(ch)
        else:
            result.append(ch)
    return ''.join(result)

def seed_extract(content: str, source_domain: str, brand_context: str = "",
                 api_key: str = "", base_url: str = "https://integrate.api.nvidia.com/v1",
                 model: str = "meta/llama-3.1-8b-instruct") -> dict:
    if not api_key:
        log("No LLM API key available — skipping seed extraction")
        return {"context_summary": "", "author": {}, "pain_points": [], "signals": [], "queries": [], "leads": []}

    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=base_url)

    brand_instruction = f"\nWe are a company that {brand_context}" if brand_context else ""

    prompt = """You are a sales intelligence analyst reading web content. Your job is to find people and companies that match our target profile.

Content from: {source_domain}
{brand_instruction}

---CONTENT---
{content}
---END---

Analyze this content and extract the following. Return ONLY valid JSON (no markdown, no explanation).

Rules: only explicit content from the text, no inferences, skip dictionaries/news/reference, skip big enterprises.

Format:
{{"context_summary": "1-2 sentence summary", "author": {{"name": "name or null", "role": "title or null", "company": "company or null"}}, "pain_points": ["pain1", "pain2"], "signals": [{{"type": "pain|hiring|funding|growth|seeker", "description": "evidence"}}], "queries": [{{"text": "search query without quotes", "signal": "type"}}], "leads": [{{"name": "company or person", "domain_hint": "domain", "reason": "need evidence from content"}}]}}"""

    safe_content = content[:8000].replace("{", "{{").replace("}", "}}")
    full = prompt.format(content=safe_content, source_domain=source_domain, brand_instruction=brand_instruction)

    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": full}],
                temperature=0.0,
                max_tokens=1000,
            )
            text = resp.choices[0].message.content.strip()
            text = re.sub(r'^```\w*\n?', '', text)
            text = re.sub(r'\n?```\s*$', '', text)
            result = json.loads(text)
            result.setdefault("context_summary", "")
            result.setdefault("author", {})
            result.setdefault("pain_points", [])
            result.setdefault("signals", [])
            result.setdefault("queries", [])
            result.setdefault("leads", [])
            return result
        except json.JSONDecodeError:
            log(f"Seed extraction JSON decode failed (attempt {attempt + 1}), trying fix")
            try:
                fixed = _fix_json_unescaped(text)
                result = json.loads(fixed)
                result.setdefault("context_summary", "")
                result.setdefault("author", {})
                result.setdefault("pain_points", [])
                result.setdefault("signals", [])
                result.setdefault("queries", [])
                result.setdefault("leads", [])
                return result
            except json.JSONDecodeError:
                log(f"Seed extraction JSON fix also failed")
        except Exception as e:
            log(f"Seed extraction LLM call failed (attempt {attempt + 1}): {e}")
            if attempt < 2:
                time.sleep(2 ** attempt * 5)

    return {"context_summary": "", "author": {}, "pain_points": [], "signals": [], "queries": [], "leads": []}

def main():
    if len(sys.argv) >= 2:
        params = json.loads(sys.argv[1])
    else:
        params = json.loads(sys.stdin.read())

    content = params.get("content", "")
    source_domain = params.get("source_domain", "unknown.com")
    brand_context = params.get("brand_context", "")
    api_key = params.get("llm_api_key", "")
    base_url = params.get("llm_base_url", "https://integrate.api.nvidia.com/v1")
    model = params.get("llm_model", "meta/llama-3.1-8b-instruct")

    if not content or len(content) < 200:
        result = {"context_summary": "", "author": {}, "pain_points": [], "signals": [], "queries": [], "leads": []}
    else:
        start = time.time()
        result = seed_extract(content, source_domain, brand_context, api_key, base_url, model)
        result["_duration_ms"] = int((time.time() - start) * 1000)

    _REAL_STDOUT.write(json.dumps(result) + "\n")
    _REAL_STDOUT.flush()

if __name__ == "__main__":
    main()
