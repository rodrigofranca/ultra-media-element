/** result-cycle3.md, defect 2 - a Date with a finite getTime(), or null. Never an Invalid Date. */
export function normalizeLiveDate(date: Date | null | undefined): Date | null {
  return date && Number.isFinite(date.getTime()) ? date : null;
}
