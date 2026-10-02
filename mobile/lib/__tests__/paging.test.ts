import {
  afterCursorFilter,
  cleanSearchTerm,
  documentTypesMatching,
  MAX_SEARCH_LENGTH,
  PAGE_SIZE,
  pageOf,
  transactionSearchFilter,
} from '@/lib/paging';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = (count: number) =>
  Array.from({ length: count }, (_, n) => ({ id: id(n), created_at: `2026-10-01T10:00:${String(n % 60).padStart(2, '0')}+00:00` }));
const cursorOf = (row: { id: string; created_at: string }) => ({ at: row.created_at, id: row.id });

describe('pageOf', () => {
  it('has no next page when the extra row did not come back', () => {
    const page = pageOf(rows(PAGE_SIZE), cursorOf);
    expect(page.rows).toHaveLength(PAGE_SIZE);
    expect(page.nextCursor).toBeNull();
  });

  it('drops the extra row and takes the cursor from the last row shown', () => {
    const fetched = rows(PAGE_SIZE + 1);
    const page = pageOf(fetched, cursorOf);
    expect(page.rows).toHaveLength(PAGE_SIZE);
    expect(page.nextCursor).toEqual(cursorOf(fetched[PAGE_SIZE - 1]));
  });
});

describe('afterCursorFilter', () => {
  it('breaks timestamp ties on id so no row is repeated or skipped', () => {
    expect(afterCursorFilter('created_at', { at: '2026-10-01T10:00:00+00:00', id: id(7) })).toBe(
      `created_at.lt."2026-10-01T10:00:00+00:00",and(created_at.eq."2026-10-01T10:00:00+00:00",id.lt.${id(7)})`,
    );
  });
});

describe('cleanSearchTerm', () => {
  it('removes characters that would restructure a PostgREST filter', () => {
    expect(cleanSearchTerm('  INV,0001)  or(id.eq.1) %_*"\'\\ ')).toBe('INV 0001 or id.eq.1');
  });

  it('caps the length', () => {
    expect(cleanSearchTerm('a'.repeat(200))).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it('is empty for whitespace', () => {
    expect(cleanSearchTerm('   ')).toBe('');
  });
});

describe('transactionSearchFilter', () => {
  it('searches invoice number and parties', () => {
    expect(transactionSearchFilter('INV-0001')).toBe(
      'invoice_number.ilike.*INV-0001*,parties.ilike.*INV-0001*',
    );
  });

  it('matches document types by their label, case-insensitively', () => {
    expect(documentTypesMatching('mortgage')).toEqual(
      expect.arrayContaining(['mortgage_deed']),
    );
    expect(transactionSearchFilter('gift')).toContain('document_type.in.(deed_of_gift)');
  });
});
