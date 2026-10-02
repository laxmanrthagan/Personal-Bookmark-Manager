import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBookmarkTitle, validateBookmarkUrl, validateTagInput } from '../src/validation.js';

test('accepts trimmed HTTP and HTTPS URLs', () => {
  assert.equal(validateBookmarkUrl('  https://example.com/path  '), '');
  assert.equal(validateBookmarkUrl('http://localhost:3000/'), '');
  assert.equal(validateBookmarkUrl('https://[::1]/'), '');
});

test('rejects empty, malformed, unsafe, credential-bearing, whitespace, and oversized URLs', () => {
  for (const value of [
    '',
    '   ',
    'not a URL',
    'javascript:alert(1)',
    'file:///private/document',
    'https://user:secret@example.com/',
    'https://example.com/a b',
    'https://example..com/',
    'https://example.com/' + 'a'.repeat(2048),
  ]) {
    assert.notEqual(validateBookmarkUrl(value), '', `Expected rejection for: ${value.slice(0, 60)}`);
  }
});

test('validates title length', () => {
  assert.equal(validateBookmarkTitle('A title'), '');
  assert.equal(validateBookmarkTitle(''), '');
  assert.match(validateBookmarkTitle('x'.repeat(301)), /300 characters/u);
  assert.notEqual(validateBookmarkTitle(null), '');
});

test('validates optional comma-separated tags and tag length/count limits', () => {
  assert.equal(validateTagInput(''), '');
  assert.equal(validateTagInput(' , Research,  design ideas '), '');
  assert.equal(validateTagInput(`${Array.from({ length: 20 }, (_, index) => `tag-${index}`).join(',')}, ,`), '');
  assert.equal(validateTagInput(Array.from({ length: 25 }, () => 'same').join(',')), '');
  assert.match(validateTagInput(Array.from({ length: 21 }, (_, index) => `tag-${index}`).join(',')), /20 tags/u);
  assert.match(validateTagInput('x'.repeat(41)), /40 characters/u);
});