import QRCode from 'qrcode';

/**
 * Generates a QR code as an SVG string.
 *
 * SVG rather than a data URL image: `qrcode`'s toDataURL path needs a canvas,
 * which React Native does not have, whereas toString with type 'svg' is pure
 * string building. The same output then serves both consumers, the certificate
 * screen (rendered with react-native-svg) and the PDF (inlined into the HTML),
 * so the code on screen and the code on the document are byte for byte the
 * same image.
 *
 * Error correction is set to M. A certificate may be printed, photocopied and
 * photographed before anyone scans it, and M tolerates roughly 15 percent
 * damage without the extra density that H would add.
 */
export async function qrSvg(value: string, size = 160): Promise<string> {
  return QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: {
      dark: '#0B5D33',
      light: '#FFFFFF',
    },
  });
}
