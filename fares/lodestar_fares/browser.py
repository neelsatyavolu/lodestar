"""One shared headless Chromium for reading Google Flights booking pages."""

from __future__ import annotations

import asyncio
import logging
import re
import time

from playwright.async_api import Browser, Playwright, async_playwright

from .booking_page import BookingPage, parse_booking_page

logger = logging.getLogger(__name__)

BOOKING_BASE = "https://www.google.com/travel/flights/booking"
# A tfs token is URL-safe base64 built by fli; nothing else is accepted, so
# the browser can only ever be pointed at Google's booking page.
TFS_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{16,2048}$")
MAX_PAGES = 3
# How long a request may wait for a free browser slot before giving up, so a
# backlog of abandoned checks can't build up behind the three pages.
SLOT_WAIT_SECONDS = 20
CACHE_SECONDS = 600
LOAD_TIMEOUT_MS = 20_000
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
_LABEL_SCRIPT = """els => els.map(e => e.getAttribute('aria-label')).filter(l => l && l.startsWith('Continue to book with'))"""


class BookingPageError(Exception):
    """The booking page could not be read."""


def booking_url(tfs: str) -> str:
    if not TFS_PATTERN.fullmatch(tfs):
        raise ValueError("Invalid itinerary token.")
    return f"{BOOKING_BASE}?tfs={tfs}&curr=USD&hl=en&gl=us"


class BookingBrowser:
    def __init__(self) -> None:
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()
        self._slots = asyncio.Semaphore(MAX_PAGES)
        self._cache: dict[str, tuple[float, BookingPage]] = {}
        self._inflight: dict[str, asyncio.Task[BookingPage]] = {}

    async def _ensure(self) -> Browser:
        async with self._lock:
            if self._browser is None or not self._browser.is_connected():
                self._playwright = self._playwright or await async_playwright().start()
                self._browser = await self._playwright.chromium.launch(headless=True)
            return self._browser

    async def chromium(self) -> Browser:
        """The shared browser, for other page readers (Stays) to open their own pages in."""
        return await self._ensure()

    async def close(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._browser, self._playwright = None, None

    async def read(self, tfs: str) -> BookingPage:
        """Read one booking page, sharing work with identical requests already running."""
        booking_url(tfs)
        cached = self._cache.get(tfs)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return cached[1]
        task = self._inflight.get(tfs)
        if task is None:
            task = asyncio.create_task(self._load(tfs))
            self._inflight[tfs] = task
            task.add_done_callback(lambda _: self._inflight.pop(tfs, None))
        # shield: one caller disconnecting must not cancel the load others wait on.
        return await asyncio.shield(task)

    async def _load(self, tfs: str) -> BookingPage:
        url = booking_url(tfs)
        browser = await self._ensure()
        try:
            await asyncio.wait_for(self._slots.acquire(), timeout=SLOT_WAIT_SECONDS)
        except TimeoutError as exc:
            raise BookingPageError("Seller checks are busy right now. Try again in a moment.") from exc
        try:
            context = await browser.new_context(locale="en-US", user_agent=USER_AGENT)
            try:
                page = await context.new_page()
                await page.goto(url, wait_until="domcontentloaded", timeout=LOAD_TIMEOUT_MS)
                try:
                    await page.wait_for_selector("[aria-label^='Continue to book with']", timeout=LOAD_TIMEOUT_MS)
                except Exception as exc:  # noqa: BLE001 - surface as a domain error
                    raise BookingPageError("Google did not show booking options for this itinerary.") from exc
                # Other sellers render a beat after the first one.
                await page.wait_for_timeout(1200)
                labels = await page.eval_on_selector_all("[aria-label]", _LABEL_SCRIPT)
                text = await page.inner_text("body")
            finally:
                await context.close()
        finally:
            self._slots.release()
        result = parse_booking_page(labels, text)
        if not result.sellers:
            raise BookingPageError("No sellers were listed for this itinerary.")
        self._cache[tfs] = (time.time(), result)
        if len(self._cache) > 500:
            oldest = sorted(self._cache.items(), key=lambda kv: kv[1][0])[:100]
            for key, _ in oldest:
                self._cache.pop(key, None)
        return result
