import { chromium } from 'playwright'
import type { BrowserSession } from './runner.js'

/**
 * A visible Chromium window on the owner's machine (decision 0016), with a fresh context: no
 * Greenhouse or MyGreenhouse cookies, nothing signed in. Needs a screen; phase 2 runs on the
 * owner's own machine.
 */
export async function openVisibleBrowser(): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: null })
  return { context, close: () => browser.close() }
}
