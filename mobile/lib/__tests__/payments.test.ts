import { payInStatus, payoutStatus } from '@/lib/payments';

describe('payInStatus', () => {
  it('names each stage of the client paying the branch', () => {
    expect(payInStatus('awaiting_payment').label).toBe('Awaiting payment');
    expect(payInStatus('pending_verification').label).toBe('Being verified');
    expect(payInStatus('verified').label).toBe('Received');
    expect(payInStatus('rejected').label).toBe('Rejected');
  });
});

describe('payoutStatus', () => {
  const verified = { status: 'verified' as const, due_to_practitioner: 98000 };

  it('is pending once the payment is verified, until the branch records the transfer', () => {
    expect(payoutStatus({ ...verified, remitted_at: null })?.label).toBe('Pending');
  });

  it('is confirmed, in green, once it has', () => {
    const tone = payoutStatus({ ...verified, remitted_at: '2026-10-20T10:00:00Z' });
    expect(tone?.label).toBe('Confirmed');
    expect(tone?.color).toBe(payInStatus('verified').color);
  });

  it('has nothing to say before the client has paid', () => {
    for (const status of ['awaiting_payment', 'pending_verification', 'rejected'] as const) {
      expect(payoutStatus({ status, due_to_practitioner: 98000, remitted_at: null })).toBeNull();
    }
  });

  it('or when nothing is due', () => {
    expect(payoutStatus({ ...verified, due_to_practitioner: 0, remitted_at: null })).toBeNull();
  });
});
