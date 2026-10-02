const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function hasValidHostname(hostname) {
  const bareHostname = hostname.replace(/^\[|\]$/gu, '');
  if (!bareHostname || bareHostname === '.') return false;
  if (bareHostname.includes(':')) return true;
  const labels = bareHostname.endsWith('.') ? bareHostname.slice(0, -1).split('.') : bareHostname.split('.');
  return labels.length > 0 && labels.every((label) => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/iu.test(label)
  ));
}

export function validateBookmarkUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'Enter a website URL.';
  const url = value.trim();
  if (url.length > MAX_URL_LENGTH) return `URL must be ${MAX_URL_LENGTH} characters or fewer.`;
  if (CONTROL_CHARACTERS.test(url) || /\s/u.test(url)) return 'URL cannot contain whitespace or control characters.';

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return 'Enter a valid website URL, such as https://example.com.';
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return 'URL must start with http:// or https://.';
  if (!hasValidHostname(parsedUrl.hostname)) return 'Enter a URL with a valid website address.';
  if (parsedUrl.username || parsedUrl.password) return 'URLs containing a username or password are not allowed.';
  return '';
}

export function validateBookmarkTitle(value) {
  if (typeof value !== 'string') return 'Title must be text.';
  return value.length > MAX_TITLE_LENGTH ? `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` : '';
}

export function validateTagInput(value) {
  if (typeof value !== 'string') return 'Tags must be text.';
  const tags = value.split(',');
  const normalizedTags = new Set();

  for (const tag of tags) {
    const normalizedTag = tag.trim().replace(/\s+/gu, ' ');
    if (normalizedTag.length > MAX_TAG_LENGTH) {
      return `Each tag must be ${MAX_TAG_LENGTH} characters or fewer.`;
    }
    if (normalizedTag) normalizedTags.add(normalizedTag.toLowerCase());
  }
  if (normalizedTags.size > MAX_TAGS) return `Use no more than ${MAX_TAGS} tags.`;
  return '';
}
