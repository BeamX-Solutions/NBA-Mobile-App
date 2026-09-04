import { qrSvg } from '@/lib/qr';
import { verificationUrlFor } from '@/lib/verification';

describe('verificationUrlFor', () => {
  it('percent encodes the RBIN, whose slashes would otherwise split the path', () => {
    const url = verificationUrlFor('NBA/2026/00042');
    expect(url).toContain('/verify/');
    expect(url).toContain('NBA%2F2026%2F00042');
    expect(url).not.toContain('/verify/NBA/2026/');
  });

  it('round trips through decodeURIComponent, which is what the route does', () => {
    const rbin = 'NBA/2026/00042';
    const encoded = verificationUrlFor(rbin).split('/verify/')[1];
    expect(decodeURIComponent(encoded)).toBe(rbin);
  });
});

describe('qrSvg', () => {
  /**
   * The QR code is generated with `qrcode`'s toString rather than toDataURL
   * because React Native has no canvas. If that ever regressed, certificates
   * would carry a blank square and nothing else would fail, so it is worth a
   * test that actually renders one.
   */
  it('produces SVG markup, not a canvas data URL', async () => {
    const svg = await qrSvg(verificationUrlFor('NBA/2026/00042'));
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('data:image');
  });

  it('encodes different values differently', async () => {
    const [a, b] = await Promise.all([
      qrSvg(verificationUrlFor('NBA/2026/00042')),
      qrSvg(verificationUrlFor('NBA/2026/00043')),
    ]);
    expect(a).not.toBe(b);
  });

  it('carries the brand colour so the printed code matches the document', async () => {
    const svg = await qrSvg('https://example.test');
    expect(svg.toLowerCase()).toContain('#0b5d33');
  });

  it('handles a long URL without throwing', async () => {
    await expect(qrSvg(`https://example.test/verify/${'A'.repeat(200)}`)).resolves.toContain(
      '<svg'
    );
  });
});
