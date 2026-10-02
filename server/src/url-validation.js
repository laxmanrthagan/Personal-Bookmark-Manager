const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;

export class UrlValidationError extends Error {
  constructor(message = 'Enter a valid HTTP or HTTPS URL.') {
    super(message);
    this.name = 'UrlValidationError';
  }
}

function hasValidHostname(hostname) {
  const bareHostname = hostname.replace(/^\[|\]$/gu, '');
  if (!bareHostname || bareHostname === '.') return false;
  if (bareHostname.includes(':')) return true; // URL parsing validates bracketed IPv6 literals.

  const labels = bareHostname.endsWith('.') ? bareHostname.slice(0, -1).split('.') : bareHostname.split('.');
  return labels.length > 0 && labels.every((label) => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/iu.test(label)
  ));
}

export function parseBookmarkUrl(value) {
  if (typeof value !== 'string') throw new UrlValidationError();

  const submittedUrl = value.trim();
  if (
    submittedUrl.length === 0 ||
    submittedUrl.length > MAX_URL_LENGTH ||
    /[\u0000-\u0020\u007f-\u009f]/u.test(submittedUrl)
  ) {
    throw new UrlValidationError();
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(submittedUrl);
  } catch {
    throw new UrlValidationError();
  }

  if (
    !ALLOWED_PROTOCOLS.has(parsedUrl.protocol) ||
    !hasValidHostname(parsedUrl.hostname) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new UrlValidationError();
  }

  return {
    submittedUrl,
    normalizedUrl: parsedUrl.href,
    parsedUrl,
  };
}