/**
 * `/verify` with no RBIN in the path, so someone can type one in.
 *
 * The same screen as `/verify/[rbin]`, which simply starts with an empty
 * field. Scanning a QR code lands on the parameterised route and checks
 * automatically; typing a number by hand lands here.
 */
export { default } from './[rbin]';
