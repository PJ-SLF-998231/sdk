// How a document site shows dates, amounts and source references (the
// /design standards, "Dates, amounts and sources"). Fixed English month
// names, not Intl, so a site reads the same on every machine.

import type { SourceRef } from "./spec";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-10-08 → "8 Oct 2026", 2026-10 → "Oct 2026", 2026 → "2026". */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  const name = month ? MONTHS[Number(month) - 1] : undefined;
  if (!name) return year ?? "";
  if (!day) return `${name} ${year}`;
  return `${Number(day)} ${name} ${year}`;
}

/** "1245.50" → "1,245.50"; "-3" → "−3" (a true minus sign). */
export function formatFigure(value: string): string {
  const negative = value.startsWith("-");
  const [wholeRaw, fraction] = (negative ? value.slice(1) : value).split(".");
  const whole = wholeRaw ?? "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/** "ZAR 1,245.50", or just the figure without a currency. */
export function formatAmount(value: string, currency?: string): string {
  const figure = formatFigure(value);
  return currency ? `${currency} ${figure}` : figure;
}

/** {page: 1, line: 12} → "Page 1 · Line 12"; either part alone on its own. */
export function formatRef(ref: SourceRef): string {
  const parts: string[] = [];
  if (ref.page !== undefined) parts.push(`Page ${ref.page}`);
  if (ref.line !== undefined) parts.push(`Line ${ref.line}`);
  return parts.join(" · ");
}
