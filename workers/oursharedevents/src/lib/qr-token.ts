/**
 * The shape of a placed poster's scan token (`poster_deployments.qr_token`).
 *
 * One definition, two readers: the scan route (`/q/:token`, handlers/qr-scan.ts)
 * sends any other token home before it reads the database, and the go-live
 * gate (lib/code-validity.ts) does not count a poster whose token the scan
 * route would send home.
 */

/** qr_token must start with 'qrt_' and be <= 128 chars to be a valid poster token. */
export function isValidQrTokenShape(token: string): boolean {
  return token.startsWith('qrt_') && token.length <= 128;
}
