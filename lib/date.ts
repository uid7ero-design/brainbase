export function parseLocalDate(dateStr: string): Date {
  const s = dateStr.slice(0, 10)
  const [y, m, d] = s.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d))
}

export function formatDateAU(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
}
