import { convert, type HtmlToTextOptions } from 'html-to-text'

const OPTIONS = {
  wordwrap: false,
  selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }],
} satisfies HtmlToTextOptions

export function htmlToPlainText(html: string): string {
  return convert(html, OPTIONS).trim()
}
