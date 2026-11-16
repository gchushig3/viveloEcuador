/** Los horarios del operador se interpretan en America/Guayaquil (UTC-05:00). */
export function canCancelTurn(date: string, time: string | undefined, now: number): boolean {
  const startsAt = Date.parse(`${date}T${time ?? ''}-05:00`);
  return Number.isFinite(startsAt) && startsAt - now >= 86_400_000;
}
