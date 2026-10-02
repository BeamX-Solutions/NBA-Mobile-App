import type { DocumentType } from '@/lib/fees';
import { documentTypeLabels } from '@/lib/fees';

/**
 * Keyset paging and search for the practitioner's own lists, newest first.
 *
 * The Transactions and Certificates tabs used to load the whole history and
 * search only what was loaded. They now fetch a page at a time and let the
 * database do the searching, so neither gets slower as a practice's history
 * grows. The same rules as the web app (NBA-WEB-APP lib/paging.ts and
 * lib/transactions/search.ts), so both clients find the same rows.
 *
 * A page ends at the last row's timestamp and id, and the next starts strictly
 * after it. Unlike an offset, a row inserted in the meantime cannot shift the
 * next page and repeat or skip a record.
 */

export const PAGE_SIZE = 20;

export interface Cursor {
  at: string;
  id: string;
}

/** The PostgREST `or` filter for rows strictly after the cursor, ordered by `column` desc, id desc. */
export function afterCursorFilter(column: string, cursor: Cursor): string {
  return `${column}.lt."${cursor.at}",and(${column}.eq."${cursor.at}",id.lt.${cursor.id})`;
}

/**
 * Splits a page fetched with one extra row. The extra row only says there is
 * more; the cursor comes from the last row actually shown.
 */
export function pageOf<T>(
  rows: readonly T[],
  cursorOf: (row: T) => Cursor,
): { rows: T[]; nextCursor: Cursor | null } {
  if (rows.length <= PAGE_SIZE) {
    return { rows: [...rows], nextCursor: null };
  }
  const page = rows.slice(0, PAGE_SIZE);
  return { rows: page, nextCursor: cursorOf(page[page.length - 1]) };
}

export const MAX_SEARCH_LENGTH = 80;

/**
 * The search box's text as it may reach a PostgREST filter. Characters that
 * structure a filter (`,()"'\`) or act as wildcards (`%_*`) are removed,
 * whitespace is collapsed, and the length is capped.
 */
export function cleanSearchTerm(value: string): string {
  return value
    .replace(/[,()"'\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}

/** Document types whose label contains the term. The card shows the label, not the stored value. */
export function documentTypesMatching(term: string): DocumentType[] {
  const needle = term.toLowerCase();
  if (needle === '') {
    return [];
  }
  return (Object.keys(documentTypeLabels) as DocumentType[]).filter((type) =>
    documentTypeLabels[type].toLowerCase().includes(needle),
  );
}

/** The PostgREST `or` filter for a cleaned, non-empty term: invoice number, parties, or document type. */
export function transactionSearchFilter(term: string): string {
  const clauses = [`invoice_number.ilike.*${term}*`, `parties.ilike.*${term}*`];
  const types = documentTypesMatching(term);
  if (types.length > 0) {
    clauses.push(`document_type.in.(${types.join(',')})`);
  }
  return clauses.join(',');
}
