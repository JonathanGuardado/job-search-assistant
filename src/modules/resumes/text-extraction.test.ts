import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { extractResumeText } from './text-extraction.js'

const fixture = (name: string) => readFile(new URL(`./__fixtures__/${name}`, import.meta.url))

// A valid one-page PDF with no text on it, like a scanned resume without OCR.
const PDF_WITHOUT_TEXT = new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
trailer << /Root 1 0 R >>
%%EOF`)

describe('extractResumeText', () => {
  it('reads a text-based PDF', async () => {
    const result = await extractResumeText(await fixture('synthetic-resume.pdf'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ contentType: 'application/pdf', extractor: 'unpdf' })
    expect(result.value.text).toContain('Senior Backend Engineer')
    expect(result.value.text).toContain('Reduced p99 latency by 40%')
  })

  it('reads a DOCX', async () => {
    const result = await extractResumeText(await fixture('synthetic-resume.docx'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.extractor).toBe('mammoth')
    expect(result.value.text).toContain('Globex S.A. de C.V.')
    expect(result.value.text).toContain('2017 - ene 2020')
  })

  it('identifies the type from the bytes, not the file name', async () => {
    const result = await extractResumeText(await fixture('synthetic-resume.txt'))
    expect(!result.ok && result.error.message).toMatch(/Only PDF and Word/)
  })

  it('rejects a zip that is not a Word document', async () => {
    const notDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)])
    const result = await extractResumeText(notDocx)
    expect(!result.ok && result.error.code).toBe('invalid_input')
  })

  it('rejects a PDF with no text layer instead of sending nothing to the model', async () => {
    const result = await extractResumeText(PDF_WITHOUT_TEXT)
    expect(!result.ok && result.error.message).toMatch(/No text could be read/)
  })
})
