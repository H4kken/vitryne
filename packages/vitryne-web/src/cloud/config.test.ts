// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

describe("config.json", () => {
  const base = "https://vitryne.example/app/index.html";
  it("names a backend and resolves relative URLs against the page", () => {
    expect(
      parseConfig(
        '{"backend":{"url":"/","publishableKey":"k"},"privacyPolicy":"privacy.html"}',
        base,
      ),
    ).toEqual({
      url: "https://vitryne.example",
      publishableKey: "k",
      privacyPolicy: "https://vitryne.example/app/privacy.html",
      termsOfService: null,
    });
  });
  it("reads the terms of service, empty meaning none", () => {
    const c = (t: string) =>
      parseConfig(
        `{"backend":{"url":"/","publishableKey":"k"},"termsOfService":"${t}"}`,
        base,
      );
    expect(c("https://docs.vitryne.example/terms")?.termsOfService).toBe(
      "https://docs.vitryne.example/terms",
    );
    expect(c("")?.termsOfService).toBeNull();
  });
  it("names no backend when absent, not JSON, or incomplete", () => {
    expect(parseConfig("<!doctype html>", base)).toBeNull();
    expect(parseConfig("{}", base)).toBeNull();
    expect(parseConfig('{"backend":{"url":"https://x"}}', base)).toBeNull();
    expect(parseConfig("null", base)).toBeNull();
  });
});
