/*
 * English country names → ISO 3166-1 alpha-2, for sources that name countries instead of
 * coding them. A name this does not know is null, never a guess: the caller leaves it out.
 */

// Intl also names things that are not countries: the EU, the eurozone, the UN, pseudo-locales.
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'])

/** ISO 3166 short names that differ from the names Intl gives the same countries. */
const ISO_NAMES: Readonly<Record<string, string>> = {
  'Bonaire, Sint Eustatius and Saba': 'BQ', 'Brunei Darussalam': 'BN', 'Cabo Verde': 'CV', Congo: 'CG',
  'Congo, The Democratic Republic of the': 'CD', 'Falkland Islands (Malvinas)': 'FK', 'Heard Island and McDonald Islands': 'HM',
  'Holy See (Vatican City State)': 'VA', 'Hong Kong': 'HK', "Lao People's Democratic Republic": 'LA', Macao: 'MO',
  'Micronesia, Federated States of': 'FM', Myanmar: 'MM', 'Palestine, State of': 'PS', Pitcairn: 'PN', 'Russian Federation': 'RU',
  'Saint Barthélemy': 'BL', 'Saint Helena, Ascension and Tristan da Cunha': 'SH', 'Saint Kitts and Nevis': 'KN', 'Saint Lucia': 'LC',
  'Saint Martin (French part)': 'MF', 'Saint Pierre and Miquelon': 'PM', 'Saint Vincent and the Grenadines': 'VC',
  'Sint Maarten (Dutch part)': 'SX', 'South Georgia and the South Sandwich Islands': 'GS', 'Syrian Arab Republic': 'SY', Turkey: 'TR',
  'United States Minor Outlying Islands': 'UM', 'Virgin Islands, British': 'VG', 'Virgin Islands, U.S.': 'VI',
}

/** Case, accents and punctuation do not tell two countries apart. */
const fold = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z]+/g, ' ').trim()

function buildCodesByName(): ReadonlyMap<string, string> {
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const byName = new Map<string, string>()
  for (const first of letters) {
    for (const second of letters) {
      const code = first + second
      const name = names.of(code)
      // Intl echoes a code it has no name for, and still names retired codes ("UK", "SU"): only current ones count.
      const isCurrent = name !== undefined && name !== code && new Intl.Locale(`und-${code}`).region === code
      if (isCurrent && !NOT_COUNTRIES.has(code)) byName.set(fold(name), code)
    }
  }
  for (const [name, code] of Object.entries(ISO_NAMES)) byName.set(fold(name), code)
  return byName
}

let codesByName: ReadonlyMap<string, string> | null = null

export function countryCodeOf(name: string): string | null {
  codesByName ??= buildCodesByName()
  return codesByName.get(fold(name)) ?? null
}
