import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Route } from 'playwright'
import type { ApplicationPages } from '@/modules/job-sources'

/*
 * Test helpers: GitLab's real application page, replayed offline from a recording of what it
 * loaded (scripts/greenhouse-dry-run.ts --har), with the tests playing Greenhouse. Requests
 * are answered or aborted in the browser here, never sent: interception lives only in tests
 * and the dry run (decision 0016).
 */

export const GITLAB_PAGES: ApplicationPages = {
  page: 'https://job-boards.greenhouse.io/gitlab/jobs/8725225002',
  embedPage: 'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8725225002',
  applicationUrls: ['https://boards.greenhouse.io/gitlab/jobs/8725225002', 'https://boards.greenhouse.io/embed/gitlab/jobs/8725225002'],
}
export const GITLAB_APPLICATION = /^https:\/\/boards\.greenhouse\.io\/(embed\/)?gitlab\/jobs\/8725225002$/
const HAR = fileURLToPath(new URL('./__fixtures__/greenhouse-gitlab-page.har', import.meta.url))

/**
 * How Greenhouse answers the application: accepted (then its confirmation page), rejected, the
 * request fails, or a security code is emailed first and the application accepted with it.
 */
export type Greenhouse = 'accepts' | 'rejects' | 'fails' | 'asks_code'

/** The code the tests' owner reads from the email Greenhouse "sent". */
export const SECURITY_CODE = 'ABCD1234'
/*
 * Greenhouse's answers by their `code`, as its page script handles them (entry.client in the
 * recording): "captcha-failed" with a recipient shows the security-code box, and the next
 * Submit sends `security_code`. The 428 status is what three real Canonical forms answered.
 */
const CODE_EMAILED = '{"code":"captcha-failed","security_code_recipient":"ana@example.com"}'
const INVALID = '{"code":"invalid-attributes","message":"email"}'

function answer(route: Route, greenhouse: Greenhouse) {
  const request = route.request()
  if (request.isNavigationRequest() && request.url().endsWith('/confirmation')) {
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><h1>Thank you for applying.</h1></body></html>' })
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback()
  if (request.url().includes('.s3.amazonaws.com')) {
    const key = /name="key"\r?\n\r?\n([^\r\n]+)/.exec(request.postData() ?? '')?.[1] ?? 'key'
    return route.fulfill({
      status: 201, contentType: 'application/xml', headers: { 'access-control-allow-origin': '*' },
      body: `<?xml version="1.0"?><PostResponse><Location>${request.url()}${key}</Location><Bucket>b</Bucket><Key>${key}</Key><ETag>"0"</ETag></PostResponse>`,
    })
  }
  if (GITLAB_APPLICATION.test(request.url())) {
    if (greenhouse === 'fails') return route.abort('connectionreset')
    const json = (status: number, body: string) => route.fulfill({ status, contentType: 'application/json', body })
    if (greenhouse === 'rejects') return json(422, INVALID)
    if (greenhouse === 'asks_code' && !(request.postData() ?? '').includes(`"security_code":"${SECURITY_CODE}"`)) return json(428, CODE_EMAILED)
    return json(200, '{}')
  }
  return route.abort()
}

/** A fresh context in which GitLab's page replays and Greenhouse answers as told. */
export async function replayContext(browser: Browser, greenhouse: Greenhouse): Promise<BrowserContext> {
  const context = await browser.newContext({ timezoneId: 'UTC', locale: 'en-US' })
  await context.routeFromHAR(HAR, { notFound: 'abort' })
  await context.route('**/*', (route) => answer(route, greenhouse))
  return context
}
