"""SSRF-safe HTTP helpers for connectors (allowlist + resolved IP checks)."""

from __future__ import annotations

import asyncio
import logging
import re
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

BLOCKED_IP_PATTERNS = [
    re.compile(r"^10\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^172\.(1[6-9]|2[0-9]|3[01])\."),
    re.compile(r"^127\."),
    re.compile(r"^::1$", re.I),
    re.compile(r"^localhost$", re.I),
    re.compile(r"^0\.0\.0\.0$"),
    re.compile(r"^169\.254\."),
    re.compile(r"^fc00:", re.I),
    re.compile(r"^fe80:", re.I),
]

# Hostnames allowed (exact or subdomain)
ALLOWED_HOST_SUFFIXES: tuple[str, ...] = (
    "efts.sec.gov",
    "www.sec.gov",
    "sec.gov",
    "www.courtlistener.com",
    "courtlistener.com",
    "api.github.com",
    "github.com",
    "api.firecrawl.dev",
    "firecrawl.dev",
    "api.duckduckgo.com",
    "duckduckgo.com",
    "newsapi.org",
    "api.gdeltproject.org",
    "gdeltproject.org",
    "www.bing.com",
    "bing.com",
    "remotive.com",
    "api.adzuna.com",
    "adzuna.com",
    "api.openai.com",
    "openai.com",
    "api.groq.com",
    "groq.com",
    "api.together.xyz",
    "together.xyz",
    "api-atlas.nomic.ai",
    "nomic.ai",
    "en.wikipedia.org",
    "wikipedia.org",
    "autocomplete.clearbit.com",
)


def _host_allowed(host: str) -> bool:
    h = (host or "").lower().rstrip(".")
    if not h:
        return False
    for suf in ALLOWED_HOST_SUFFIXES:
        if h == suf or h.endswith("." + suf):
            return True
    return False


def _ip_blocked(ip: str) -> bool:
    s = ip.strip()
    for pat in BLOCKED_IP_PATTERNS:
        if pat.search(s):
            return True
    return False


def validate_http_url(url: str, *, entity_domain: str | None = None) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"SSRF: invalid scheme for {url!r}")
    host = (parsed.hostname or "").lower()
    if entity_domain and host_matches_entity(host, entity_domain):
        pass
    elif not _host_allowed(host):
        raise ValueError(f"SSRF: host not allowed: {host}")
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ValueError(f"SSRF: DNS failed for {host}: {e}") from e
    for info in infos:
        ip = info[4][0]
        if _ip_blocked(ip):
            raise ValueError(f"SSRF: resolved IP blocked: {ip}")


async def safe_get(url: str, **kwargs: Any) -> httpx.Response:
    entity_domain = kwargs.pop("entity_domain", None)
    validate_http_url(url, entity_domain=entity_domain)
    timeout = kwargs.pop("timeout", 8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.get(url, **kwargs)


async def safe_post(url: str, **kwargs: Any) -> httpx.Response:
    entity_domain = kwargs.pop("entity_domain", None)
    validate_http_url(url, entity_domain=entity_domain)
    timeout = kwargs.pop("timeout", 8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(url, **kwargs)


async def safe_head(url: str, **kwargs: Any) -> httpx.Response:
    entity_domain = kwargs.pop("entity_domain", None)
    validate_http_url(url, entity_domain=entity_domain)
    timeout = kwargs.pop("timeout", 8.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.head(url, **kwargs)


def safe_get_sync(url: str, **kwargs: Any) -> httpx.Response:
    entity_domain = kwargs.pop("entity_domain", None)
    validate_http_url(url, entity_domain=entity_domain)
    timeout = kwargs.pop("timeout", 8.0)
    with httpx.Client(timeout=timeout) as client:
        return client.get(url, **kwargs)


def safe_post_sync(url: str, **kwargs: Any) -> httpx.Response:
    entity_domain = kwargs.pop("entity_domain", None)
    validate_http_url(url, entity_domain=entity_domain)
    timeout = kwargs.pop("timeout", 8.0)
    with httpx.Client(timeout=timeout) as client:
        return client.post(url, **kwargs)


async def validate_url_in_executor(url: str) -> None:
    await asyncio.to_thread(validate_http_url, url)
