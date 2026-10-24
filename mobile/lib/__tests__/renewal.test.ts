import { canRenew, renewalOpensAt } from '@/lib/renewal';

const now = new Date('2026-10-25T10:00:00Z');

describe('renewal', () => {
  it('opens 7 days before expiry', () => {
    expect(renewalOpensAt('2027-01-25T00:00:00Z')?.toISOString()).toBe('2027-01-18T00:00:00.000Z');
  });

  it('is not offered on a subscription just bought', () => {
    expect(canRenew('2027-01-25T00:00:00Z', now)).toBe(false);
  });

  it('is offered within 7 days of expiry', () => {
    expect(canRenew('2026-10-30T00:00:00Z', now)).toBe(true);
    expect(canRenew('2026-11-01T10:00:00Z', now)).toBe(true);
    expect(canRenew('2026-11-01T10:00:01Z', now)).toBe(false);
  });

  it('is offered rather than hidden when the date is unreadable', () => {
    expect(renewalOpensAt('not a date')).toBeNull();
    expect(canRenew('not a date', now)).toBe(true);
  });
});
