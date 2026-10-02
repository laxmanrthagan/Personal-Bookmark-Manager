import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { parse } from 'parse5';
import { parseBookmarkUrl } from './url-validation.js';

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const DNS_TIMEOUT_MS = 3000;
const MAX_TITLE_LENGTH = 300;
const TITLE_UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function getHostname(url) {
  return url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
}

function isPublicAddress(address) {
  try {
    const parsedAddress = ipaddr.parse(address);
    if (parsedAddress.kind() === 'ipv6' && parsedAddress.isIPv4MappedAddress()) return false;
    return parsedAddress.range() === 'unicast';
  } catch {
    return false;
  }
}

async function lookupWithTimeout(hostname) {
  let timeout;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('DNS lookup timed out.')), DNS_TIMEOUT_MS);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePublicAddress(url) {
  const hostname = getHostname(url);
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Local hostnames are not allowed for title lookup.');
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupWithTimeout(hostname);

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('The URL does not resolve exclusively to public addresses.');
  }

  // Pin the connection to the validated address to prevent a second DNS lookup
  // from resolving the same hostname to a private address.
  return addresses[0];
}

function findTitle(node) {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.tagName === 'title') return current;
    for (let index = (current.childNodes?.length ?? 0) - 1; index >= 0; index -= 1) {
      pending.push(current.childNodes[index]);
    }
  }
  return null;
}

function collectText(node) {
  const pending = [node];
  const textParts = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.nodeName === '#text') {
      textParts.push(current.value ?? '');
      continue;
    }
    for (let index = (current.childNodes?.length ?? 0) - 1; index >= 0; index -= 1) {
      pending.push(current.childNodes[index]);
    }
  }
  return textParts.join('');
}

export function extractPageTitle(html) {
  const titleNode = findTitle(parse(html));
  if (!titleNode) return null;

  const title = collectText(titleNode)
    .replace(TITLE_UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);

  return title || null;
}

function requestHtml(url, pinnedAddress) {
  const hostname = getHostname(url);
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== expectedPort) {
    throw new Error('Non-standard ports are not allowed for title lookup.');
  }

  return new Promise((resolve, reject) => {
    let overallTimeout;
    const finish = (callback, value) => {
      clearTimeout(overallTimeout);
      callback(value);
    };
    const request = transport({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'User-Agent': 'PersonalBookmarkManager/1.0',
      },
      lookup: (_requestedHostname, options, callback) => {
        if (typeof options === 'function') callback = options;
        const result = {
          address: pinnedAddress.address,
          family: pinnedAddress.family,
        };
        if (options?.all) callback(null, [result]);
        else callback(null, result.address, result.family);
      },
      ...(url.protocol === 'https:' && !isIP(hostname) ? { servername: hostname } : {}),
    }, (response) => {
      response.on('error', (error) => finish(reject, error));
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.destroy();
        finish(resolve, { statusCode, location });
        return;
      }

      const contentType = response.headers['content-type'] ?? '';
      if (!/^\s*(text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/iu.test(contentType)) {
        response.destroy();
        finish(resolve, { statusCode, contentType, body: null });
        return;
      }

      const contentLength = Number(response.headers['content-length'] ?? 0);
      if (contentLength > MAX_RESPONSE_BYTES) {
        response.destroy(new Error('Page response exceeded the title lookup size limit.'));
        request.destroy(new Error('Page response exceeded the title lookup size limit.'));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          const error = new Error('Page response exceeded the title lookup size limit.');
          response.destroy(error);
          request.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        finish(resolve, { statusCode, contentType, body: Buffer.concat(chunks).toString('utf8') });
      });
    });

    overallTimeout = setTimeout(() => {
      request.destroy(new Error('Page title lookup timed out.'));
    }, REQUEST_TIMEOUT_MS);
    overallTimeout.unref?.();
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Page title lookup timed out.'));
    });
    request.on('error', (error) => finish(reject, error));
    request.end();
  });
}

export async function fetchPageTitle(inputUrl) {
  let { parsedUrl } = parseBookmarkUrl(inputUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const pinnedAddress = await resolvePublicAddress(parsedUrl);
    const response = await requestHtml(parsedUrl, pinnedAddress);

    if (response.statusCode >= 300 && response.statusCode < 400 && response.location) {
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many redirects during title lookup.');
      const nextUrl = new URL(response.location, parsedUrl);
      if (parsedUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
        throw new Error('HTTPS title lookup cannot redirect to an insecure URL.');
      }
      parsedUrl = parseBookmarkUrl(nextUrl.href).parsedUrl;
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Title lookup returned HTTP ${response.statusCode}.`);
    }

    if (!response.body) return null;
    return extractPageTitle(response.body);
  }

  return null;
}