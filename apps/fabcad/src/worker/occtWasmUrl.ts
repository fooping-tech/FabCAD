/**
 * Resolve the Open CASCADE WebAssembly asset.
 *
 * The opt-in replacement is always a same-origin file under Vite's BASE_URL.
 * It deliberately does not accept an arbitrary external URL from user input,
 * keeping the official deployment unchanged and reducing supply-chain risk.
 */
export function resolveOcctWasmUrl(
  bundledUrl: string,
  baseUrl: string,
  useOverride: boolean,
): string {
  if (!useOverride) return bundledUrl;
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}occt-override.wasm`;
}
