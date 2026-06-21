import sys, json, re, asyncio
from playwright.async_api import async_playwright

EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
LINKEDIN_RE = re.compile(r'linkedin\.com/in/[a-zA-Z0-9_-]+')
NAME_TITLE_RE = re.compile(r'(?:Founder|CEO|Director|Manager|Owner|President|Head|Lead)\s*[:\-–]\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)')

async def extract_contacts(domain: str, company_name: str) -> list[dict]:
    found: list[dict] = []
    seen_emails: set[str] = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        )

        for path in ["/contact", "/about", "/team", "/about-us"]:
            page = await context.new_page()
            try:
                await page.goto(f"https://{domain}{path}", timeout=8000, wait_until="domcontentloaded")
                text = await page.inner_text("body")

                for m in EMAIL_RE.finditer(text):
                    email = m.group(0).lower()
                    if email not in seen_emails and "example" not in email and "domain" not in email:
                        seen_emails.add(email)
                        entry: dict = {"email": email, "source": f"https://{domain}{path}"}
                        name_m = NAME_TITLE_RE.search(text)
                        if name_m:
                            entry["name"] = name_m.group(1).strip()
                        li_m = LINKEDIN_RE.search(text)
                        if li_m:
                            entry["linkedin"] = f"https://{li_m.group(0)}"
                        found.append(entry)
            except Exception:
                pass
            finally:
                await page.close()

        # Google search for company contact info
        if not found:
            page = await context.new_page()
            try:
                query = f"{company_name} {' OR '.join(company_name.split()[:2])} email contact founder LinkedIn"
                await page.goto(f"https://html.duckduckgo.com/html/?q={query}", timeout=10000, wait_until="domcontentloaded")
                text = await page.inner_text("body")

                for m in LINKEDIN_RE.finditer(text):
                    li = f"https://{m.group(0)}"
                    if not any(c.get("linkedin") == li for c in found):
                        found.append({"linkedin": li, "source": "web_search"})

                for m in EMAIL_RE.finditer(text):
                    email = m.group(0).lower()
                    if email not in seen_emails and "example" not in email and "domain" not in email:
                        seen_emails.add(email)
                        found.append({"email": email, "source": "web_search"})
            except Exception:
                pass
            finally:
                await page.close()

        await browser.close()

    return found


async def main():
    args = json.loads(sys.argv[1])
    domain = args.get("domain", "")
    company_name = args.get("company_name", "")

    try:
        contacts = await asyncio.wait_for(
            extract_contacts(domain, company_name),
            timeout=90,
        )
        print(json.dumps({"success": True, "contacts": contacts, "domain": domain}))
    except asyncio.TimeoutError:
        print(json.dumps({"success": False, "error": "timeout", "domain": domain}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "domain": domain}))


if __name__ == "__main__":
    asyncio.run(main())
