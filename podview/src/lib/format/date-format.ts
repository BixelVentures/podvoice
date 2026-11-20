// Cached Intl formatters. Date#toLocaleTimeString builds a new Intl.DateTimeFormat on every call;
// the clock, weather hours and "Opdateret" labels run on every redraw. Same output, one formatter.
const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatDate(
  date: Date | number,
  options?: Intl.DateTimeFormatOptions,
  locale = 'da-DK',
): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}
