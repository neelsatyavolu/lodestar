"""Read Google Hotels pages in the shared headless Chromium (see stays_page for the parsing)."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from datetime import date
from typing import TypeVar

from playwright.async_api import Browser, Page

from .browser import USER_AGENT
from .stays_page import Hotel, Offer, parse_offers, parse_search, prices_url, search_url

T = TypeVar("T")
MAX_PAGES = 3
SLOT_WAIT_SECONDS = 20
CACHE_SECONDS = 600
LOAD_TIMEOUT_MS = 25_000
# Late sellers and cards render a beat after the first ones.
SETTLE_MS = 1500

_CARDS = """els => els.map(a => {
  let card = a.parentElement;
  while (card.parentElement && card.parentElement.querySelectorAll("a[aria-label^='View prices for']").length === 1) card = card.parentElement;
  const img = card.querySelector('img');
  return { href: a.getAttribute('data-href'), labels: [...card.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')), text: card.innerText, image: img ? img.getAttribute('src') : null };
})"""
_ROWS = "els => els.map(e => ({ text: e.textContent, href: e.getAttribute('href') }))"


class StaysPageError(Exception):
    """Google Hotels did not show what we asked for."""


class StaysBrowser:
    def __init__(self, chromium: Callable[[], Awaitable[Browser]]) -> None:
        self._chromium = chromium
        self._slots = asyncio.Semaphore(MAX_PAGES)
        self._cache: dict[str, tuple[float, object]] = {}
        self._inflight: dict[str, asyncio.Task[object]] = {}

    async def search(self, city: str, checkin: date, checkout: date, adults: int) -> list[Hotel]:
        url = search_url(city, checkin, checkout, adults)

        async def read(page: Page) -> list[Hotel]:
            try:
                await page.wait_for_selector("a[aria-label^='View prices for']", state="attached", timeout=LOAD_TIMEOUT_MS)
            except Exception as exc:  # noqa: BLE001 - surface as a domain error
                raise StaysPageError(f"Google Hotels found no hotels for {city}.") from exc
            await page.wait_for_timeout(SETTLE_MS)
            hotels = parse_search(await page.eval_on_selector_all("a[aria-label^='View prices for']", _CARDS))
            if not hotels:
                raise StaysPageError(f"Google Hotels found no hotels for {city}.")
            return hotels

        return await self._shared(url, read)

    async def offers(self, key: str, checkin: date, checkout: date, adults: int) -> list[Offer]:
        url = prices_url(key, checkin, checkout, adults)

        async def read(page: Page) -> list[Offer]:
            try:
                await page.wait_for_selector("a[href*='/travel/lodging/clk']", state="attached", timeout=LOAD_TIMEOUT_MS)
            except Exception as exc:  # noqa: BLE001
                raise StaysPageError("Google Hotels listed no prices for this hotel and these dates.") from exc
            await page.wait_for_timeout(SETTLE_MS)
            offers = parse_offers(await page.eval_on_selector_all("a[href*='/travel/lodging/clk']", _ROWS), checkin)
            if not offers:
                raise StaysPageError("Google Hotels listed no prices for this hotel and these dates.")
            return offers

        return await self._shared(url, read)

    async def _shared(self, url: str, read: Callable[[Page], Awaitable[T]]) -> T:
        """One load per URL at a time, cached for a while, shielded from one caller giving up."""
        cached = self._cache.get(url)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return cached[1]  # type: ignore[return-value]
        task = self._inflight.get(url)
        if task is None:
            task = asyncio.create_task(self._load(url, read))
            self._inflight[url] = task  # type: ignore[assignment]
            task.add_done_callback(lambda _: self._inflight.pop(url, None))
        return await asyncio.shield(task)  # type: ignore[return-value]

    async def _load(self, url: str, read: Callable[[Page], Awaitable[T]]) -> T:
        browser = await self._chromium()
        try:
            await asyncio.wait_for(self._slots.acquire(), timeout=SLOT_WAIT_SECONDS)
        except TimeoutError as exc:
            raise StaysPageError("Hotel searches are busy right now. Try again in a moment.") from exc
        try:
            context = await browser.new_context(locale="en-US", user_agent=USER_AGENT)
            try:
                page = await context.new_page()
                await page.goto(url, wait_until="domcontentloaded", timeout=LOAD_TIMEOUT_MS)
                result = await read(page)
            finally:
                await context.close()
        finally:
            self._slots.release()
        self._cache[url] = (time.time(), result)
        if len(self._cache) > 500:
            for key, _ in sorted(self._cache.items(), key=lambda kv: kv[1][0])[:100]:
                self._cache.pop(key, None)
        return result
