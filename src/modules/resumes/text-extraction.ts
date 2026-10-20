import mammoth from 'mammoth'
import { extractText } from 'unpdf'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { ResumeContentType } from './types.js'

/**
 * Deterministic text extraction. No model is involved: the text must be ours so
 * that every quote the model later returns can be checked against it.
 */

export type ExtractedText = {
  readonly contentType: ResumeContentType
  readonly text: string
  readonly extractor: string
}

// Fewer characters than this means an image-only (scanned) PDF or an empty document.
const MIN_TEXT_CHARS = 100

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, i) => bytes[i] === byte)

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] // PK.. (DOCX is a zip)

/** Postgres text cannot hold NUL, and CRLF would shift offsets between platforms. */
const clean = (text: string) => text.replaceAll('\u0000', '').replace(/\r\n?/g, '\n')

async function fromPdf(bytes: Uint8Array): Promise<Result<string>> {
  try {
    // pdf.js may detach the buffer it is given; pass a copy.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true })
    return ok(text)
  } catch (error) {
    return err(domainError('invalid_input', 'The PDF could not be read. It may be encrypted or damaged.', error))
  }
}

async function fromDocx(bytes: Uint8Array): Promise<Result<string>> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    return ok(value)
  } catch (error) {
    return err(domainError('invalid_input', 'The file is not a readable Word (.docx) document.', error))
  }
}

export async function extractResumeText(bytes: Uint8Array): Promise<Result<ExtractedText>> {
  let contentType: ResumeContentType
  let extracted: Result<string>
  let extractor: string
  if (startsWith(bytes, PDF_SIGNATURE)) {
    contentType = 'application/pdf'
    extractor = 'unpdf'
    extracted = await fromPdf(bytes)
  } else if (startsWith(bytes, ZIP_SIGNATURE)) {
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    extractor = 'mammoth'
    extracted = await fromDocx(bytes)
  } else {
    return err(domainError('invalid_input', 'Only PDF and Word (.docx) files are supported.'))
  }
  if (!extracted.ok) return extracted

  const text = clean(extracted.value)
  if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
    return err(
      domainError(
        'invalid_input',
        'No text could be read from this file. Scanned resumes are not supported yet; upload a text-based PDF or a .docx.',
      ),
    )
  }
  return ok({ contentType, text, extractor })
}
