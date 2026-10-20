import { domainError, err, ok, type Result } from '@/lib/result'

// A fixed list keeps server and browser ICU versions from rendering different options.
export const CURRENCIES: readonly string[] = ["AED","AFN","ALL","AMD","ANG","AOA","ARS","AUD","AWG","AZN","BAM","BBD","BDT","BGN","BHD","BIF","BMD","BND","BOB","BRL","BSD","BTN","BWP","BYN","BZD","CAD","CDF","CHF","CLP","CNY","COP","CRC","CUC","CUP","CVE","CZK","DJF","DKK","DOP","DZD","EGP","ERN","ETB","EUR","FJD","FKP","GBP","GEL","GHS","GIP","GMD","GNF","GTQ","GYD","HKD","HNL","HRK","HTG","HUF","IDR","ILS","INR","IQD","IRR","ISK","JMD","JOD","JPY","KES","KGS","KHR","KMF","KPW","KRW","KWD","KYD","KZT","LAK","LBP","LKR","LRD","LSL","LYD","MAD","MDL","MGA","MKD","MMK","MNT","MOP","MRU","MUR","MVR","MWK","MXN","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR","PAB","PEN","PGK","PHP","PKR","PLN","PYG","QAR","RON","RSD","RUB","RWF","SAR","SBD","SCR","SDG","SEK","SGD","SHP","SLE","SLL","SOS","SRD","SSP","STN","SVC","SYP","SZL","THB","TJS","TMT","TND","TOP","TRY","TTD","TWD","TZS","UAH","UGX","USD","UYU","UZS","VES","VND","VUV","WST","XAF","XCD","XCG","XDR","XOF","XPF","XSU","YER","ZAR","ZMW","ZWG","ZWL"]
export const MAX_SALARY_MINOR = 2_147_483_647

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

export function salaryFromInput(amount: string, currency: string): Result<number | null> {
  if (!CURRENCIES.includes(currency)) return err(domainError('invalid_input', 'Choose a supported currency.'))
  const trimmed = amount.trim()
  if (trimmed === '') return ok(null)
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return err(domainError('invalid_input', 'Enter a nonnegative amount without commas.'))
  const [whole = '0', fraction = ''] = trimmed.split('.')
  const digits = fractionDigits(currency)
  if (fraction.length > digits) return err(domainError('invalid_input', `${currency} supports ${digits} decimal places.`))
  // String arithmetic avoids rounding a decimal amount through a binary float.
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')
  if (minor > BigInt(MAX_SALARY_MINOR)) return err(domainError('invalid_input', 'This amount exceeds the supported salary range.'))
  return ok(Number(minor))
}

export function salaryToInput(minor: number | null, currency: string): string {
  if (minor === null) return ''
  const digits = fractionDigits(currency)
  const padded = String(minor).padStart(digits + 1, '0')
  return digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
