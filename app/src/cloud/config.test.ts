// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

describe('config.json', () => {
  const base = 'https://vitryne.example/app/index.html';
  it('names a backend and resolves relative URLs against the page', () => {
    expect(parseConfig('{"backend":{"url":"/","publishableKey":"k"},"privacyPolicy":"privacy.html"}', base)).toEqual({
      url: 'https://vitryne.example',
      publishableKey: 'k',
      privacyPolicy: 'https://vitryne.example/app/privacy.html',
    });
  });
  it('names no backend when absent, not JSON, or incomplete', () => {
    expect(parseConfig('<!doctype html>', base)).toBeNull();
    expect(parseConfig('{}', base)).toBeNull();
    expect(parseConfig('{"backend":{"url":"https://x"}}', base)).toBeNull();
    expect(parseConfig('null', base)).toBeNull();
  });
});
