import { describe, it, expect } from "vitest";
import { sanitizeForPrompt } from "../llm/sanitize";

describe("sanitizeForPrompt", () => {
  it("should return empty string for null", () => {
    expect(sanitizeForPrompt(null)).toBe("");
  });

  it("should return empty string for undefined", () => {
    expect(sanitizeForPrompt(undefined)).toBe("");
  });

  it("should convert numbers to string", () => {
    expect(sanitizeForPrompt(123)).toBe("123");
  });

  it("should normalize line endings", () => {
    expect(sanitizeForPrompt("line1\r\nline2\rline3")).toBe(
      "line1\nline2\nline3",
    );
  });

  it("should convert tabs to spaces", () => {
    expect(sanitizeForPrompt("hello\tworld")).toBe("hello world");
  });

  it("should escape triple backticks", () => {
    const result = sanitizeForPrompt("```code```");
    expect(result).not.toContain("```");
  });

  it("should truncate long input to 10000 chars", () => {
    const longInput = "a".repeat(20000);
    const result = sanitizeForPrompt(longInput);
    expect(result.length).toBe(10000);
  });

  it("should handle normal strings without modification", () => {
    expect(sanitizeForPrompt("Hello World")).toBe("Hello World");
    expect(sanitizeForPrompt("Company: Acme Inc")).toBe("Company: Acme Inc");
  });

  it("should handle objects with toString", () => {
    const obj = { toString: () => "test object" };
    expect(sanitizeForPrompt(obj)).toBe("test object");
  });
});
