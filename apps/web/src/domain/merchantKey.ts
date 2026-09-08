/**
 * Normalizes a bank counterparty string into a stable key, so the same
 * merchant matches across statements and devices: payment-processor
 * prefixes go (CCV*, Zettle_*, SumUp*, PayPal*), store/terminal numbers
 * and dates go, punctuation collapses. "CCV*ALBERT HEIJN 1470 AMS" and
 * "Albert Heijn 1470" both become "albert heijn …".
 */
const PROCESSOR_PREFIXES = ['ccv', 'zettle', 'sumup', 'payl.', 'ideal', 'paypal', 'bck', 'sepa'];

/** drops a leading payment-processor tag ("ccv*", "zettle_", "sepa ") */
function stripProcessorPrefix(value: string): string {
  for (const prefix of PROCESSOR_PREFIXES) {
    if (!value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    // a real tag is followed by a separator — "separate" is not "sepa"
    if (prefix.endsWith('.') || /^[\s_*.]/.test(rest)) return rest.replace(/^[\s_*.]+/, '');
  }
  return value;
}

// common NL place names as they appear behind merchant names on bank
// lines ("AH DELFT", "JUMBO S GRAVENHAGE") — only TRAILING tokens are
// stripped, so a merchant actually NAMED after a city ("Café Amsterdam"
// alone) keeps its identity through the leading tokens
const TRAILING_CITIES = new Set([
  'amsterdam', 'rotterdam', 'den haag', 's gravenhage', "'s gravenhage", "'s hertogenbosch", 'utrecht', 'eindhoven', 'tilburg', 'groningen',
  'almere', 'breda', 'nijmegen', 'enschede', 'haarlem', 'arnhem', 'zaandam', 'amersfoort', 'apeldoorn',
  's hertogenbosch', 'den bosch', 'hoofddorp', 'maastricht', 'leiden', 'dordrecht', 'zoetermeer', 'zwolle',
  'delft', 'alkmaar', 'leeuwarden', 'venlo', 'deventer', 'sittard', 'geleen', 'helmond', 'heerlen',
  'hilversum', 'amstelveen', 'purmerend', 'roosendaal', 'schiedam', 'spijkenisse', 'gouda', 'vlaardingen',
  'almelo', 'assen', 'veenendaal', 'katwijk', 'zeist', 'nieuwegein', 'ede', 'emmen', 'oss', 'rijswijk',
  'middelburg', 'diemen', 'hengelo', 'lelystad', 'duivendrecht',
]);

// #201 r2: banks spell the same city three ways ("S GRAVENHAGE",
// "SGRAVENHAGE", "'s gravenhage") — comparisons squash spacing and
// punctuation so every spelling strips identically
const squashCity = (value: string): string => value.replaceAll(/[^\p{L}]/gu, '');
const SQUASHED_CITIES = new Set([...TRAILING_CITIES].map(squashCity));

/** drops trailing city tokens: "albert heijn delft" → "albert heijn" */
function stripTrailingCity(value: string): string {
  const tokens = value.split(' ');
  // cities can be two tokens ("den haag") — try the longer match first
  while (tokens.length > 1) {
    const lastTwo = squashCity(tokens.slice(-2).join(' '));
    if (tokens.length > 2 && SQUASHED_CITIES.has(lastTwo)) {
      tokens.splice(-2, 2);
      continue;
    }
    if (SQUASHED_CITIES.has(squashCity(tokens.at(-1)!))) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens.join(' ');
}

export function merchantKey(merchant: string): string {
  const base = stripProcessorPrefix(merchant.toLowerCase().trim())
    .replaceAll(/\b\d{2,}[\d./:-]*/g, ' ') // store nrs, dates, terminal ids
    .replaceAll(/[^\p{L}\p{N}&' ]+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  // branch cities differ per charge, the merchant doesn't (user request)
  return stripTrailingCity(base).slice(0, 40);
}
