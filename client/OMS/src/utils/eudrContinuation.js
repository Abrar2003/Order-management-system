// A fixed application destination avoids accepting arbitrary return URLs from sign-in queries.
export function eudrContinuation(search, pluginUrl) {
  if (new URLSearchParams(search).get('continue') !== 'eudr') return null;
  const base = new URL(pluginUrl);
  if (!['http:', 'https:'].includes(base.protocol)) return null;
  return new URL(base.href.replace(/\/$/, '') + '/api/auth/launch').href;
}
