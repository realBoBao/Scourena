#!/usr/bin/env python3
"""
scripts/web_scraper.py — Web page to Markdown converter (Node.js bridge)

Chuyển đổi web page thành Markdown sạch bằng cách:
1. Fetch URL với retry + timeout
2. Parse HTML bằng BeautifulSoup
3. Convert sang Markdown bằng markdownify

Usage:
  python web_scraper.py <url>
  python web_scraper.py --url <url> --max-length 5000

Output: JSON { url, title, markdown, error }
"""

import sys
import os
import json
import re
from pathlib import Path
from urllib.parse import urlparse

def scrape_url(url: str, max_length: int = 10000) -> dict:
    """Scrape web page and convert to Markdown."""
    import requests
    from bs4 import BeautifulSoup
    from markdownify import markdownify

    # Validate URL
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return {"url": url, "title": "", "markdown": "", "error": "Invalid URL"}

    # Fetch with retry
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    for attempt in range(3):
        try:
            resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
            resp.raise_for_status()
            break
        except Exception as e:
            if attempt == 2:
                return {"url": url, "title": "", "markdown": "", "error": str(e)}
            import time
            time.sleep(1 * (attempt + 1))

    # Parse HTML
    soup = BeautifulSoup(resp.text, "html.parser")

    # Extract title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    # Remove script, style, nav, footer, header
    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()

    # Try to find main content
    main_content = (
        soup.find("main")
        or soup.find("article")
        or soup.find("div", class_=re.compile(r"(content|article|post|entry|main)", re.I))
        or soup.find("body")
    )

    if not main_content:
        return {"url": url, "title": title, "markdown": "", "error": "No content found"}

    # Convert to Markdown
    md = markdownify(str(main_content), heading_style="ATX", strip=["img", "script", "style"])

    # Clean up
    md = re.sub(r"\n{3,}", "\n\n", md)  # Remove excessive newlines
    md = re.sub(r" {2,}", " ", md)  # Remove excessive spaces
    md = md.strip()

    # Truncate if too long
    if len(md) > max_length:
        md = md[:max_length] + "\n\n... (truncated)"

    return {"url": url, "title": title, "markdown": md, "error": None}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python web_scraper.py <url> [--max-length N]"}))
        sys.exit(1)

    # Parse args
    url = None
    max_length = 10000
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--url" and i + 1 < len(sys.argv):
            url = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--max-length" and i + 1 < len(sys.argv):
            max_length = int(sys.argv[i + 1])
            i += 2
        elif not sys.argv[i].startswith("--") and url is None:
            url = sys.argv[i]
            i += 1
        else:
            i += 1

    if not url:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)

    result = scrape_url(url, max_length)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
