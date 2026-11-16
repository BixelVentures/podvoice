// Cached Intl formatters. Date#toLocaleTimeString builds a new Intl.DateTimeFormat on every call;
// the clock, weather hours and "Opdateret" labels run on every redraw. Same output, one formatter.
const formatters = new Map();

export function formatDate(date, options, locale = 'da-DK') {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}
