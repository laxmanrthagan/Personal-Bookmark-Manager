import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPageTitle, fetchPageTitle } from '../src/page-title.js';

test('extracts and normalizes the page title as plain text', () => {
  assert.equal(
    extractPageTitle('<html><head><title>  Research &amp; Design\n Notes </title></head></html>'),
    'Research & Design Notes',
  );
  assert.equal(extractPageTitle('<html><head></head><body>No title</body></html>'), null);
});

test('rejects local destinations before making a title lookup request', async () => {
  await assert.rejects(fetchPageTitle('http://127.0.0.1/'), /public addresses/);
  await assert.rejects(fetchPageTitle('http://localhost/'), /Local hostnames/);
});