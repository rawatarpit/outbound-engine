import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  canSend,
  recordSuccess,
  recordFailure,
} from "../reputation/circuitBreaker";

vi.mock("../db/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
      upsert: vi.fn(() => ({ error: null })),
    })),
  },
}));

describe("circuitBreaker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("canSend", () => {
    it("should return true when no breaker exists", () => {
      expect(canSend("new-brand")).toBe(true);
    });

    it("should return true when state is closed", () => {
      recordSuccess("test-brand");
      expect(canSend("test-brand")).toBe(true);
    });
  });

  describe("recordSuccess", () => {
    it("should reset failure count on success", () => {
      recordFailure("brand-1");
      recordFailure("brand-1");
      recordFailure("brand-1");

      recordSuccess("brand-1");

      expect(canSend("brand-1")).toBe(true);
    });
  });

  describe("recordFailure", () => {
    it("should track failures", () => {
      recordFailure("brand-2");
      expect(canSend("brand-2")).toBe(true);
    });

    it("should open circuit after threshold failures", () => {
      const brandId = "brand-3";

      recordFailure(brandId);
      recordFailure(brandId);
      recordFailure(brandId);

      expect(canSend(brandId)).toBe(false);
    });
  });
});
