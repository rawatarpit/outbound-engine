import { describe, it, expect, beforeEach } from "vitest";
import {
  isBrandReputationSafe,
  computeBrandHealthSnapshot,
} from "../reputation/domainHealthEngine";

describe("domainHealthEngine", () => {
  describe("isBrandReputationSafe", () => {
    it("should return false when brand is null", () => {
      expect(isBrandReputationSafe(null)).toBe(false);
    });

    it("should return false when brand is paused", () => {
      const brand = createBrand({ is_paused: true });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });

    it("should return false when send_enabled is false", () => {
      const brand = createBrand({ send_enabled: false });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });

    it("should return true when brand is active with no sends", () => {
      const brand = createBrand({ sent_count: 0 });
      expect(isBrandReputationSafe(brand)).toBe(true);
    });

    it("should return false when bounce rate exceeds 2% for <10 sends", () => {
      const brand = createBrand({ sent_count: 5, bounce_count: 1 });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });

    it("should return false when bounce rate exceeds 3.5% for 10-19 sends", () => {
      const brand = createBrand({ sent_count: 15, bounce_count: 1 });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });

    it("should return false when bounce rate exceeds 5% for 20+ sends", () => {
      const brand = createBrand({ sent_count: 100, bounce_count: 6 });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });

    it("should return true when bounce rate is within threshold", () => {
      const brand = createBrand({ sent_count: 100, bounce_count: 4 });
      expect(isBrandReputationSafe(brand)).toBe(true);
    });

    it("should return false when complaint rate exceeds threshold", () => {
      const brand = createBrand({ sent_count: 100, complaint_count: 1 });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });

    it("should return true when complaint rate is within threshold", () => {
      const brand = createBrand({ sent_count: 100, complaint_count: 0 });
      expect(isBrandReputationSafe(brand)).toBe(true);
    });

    it("should return false when complaint rate exceeds 0.1% for <10 sends", () => {
      const brand = createBrand({ sent_count: 5, complaint_count: 1 });
      expect(isBrandReputationSafe(brand)).toBe(false);
    });
  });

  describe("computeBrandHealthSnapshot", () => {
    it("should return null when brand is null", () => {
      expect(computeBrandHealthSnapshot(null)).toBe(null);
    });

    it("should return health metrics with defaults", () => {
      const brand = createBrand({});
      const snapshot = computeBrandHealthSnapshot(brand);

      expect(snapshot).not.toBeNull();
      expect(snapshot?.sent).toBe(0);
      expect(snapshot?.bounces).toBe(0);
      expect(snapshot?.complaints).toBe(0);
      expect(snapshot?.sendEnabled).toBe(false);
    });

    it("should calculate rates correctly", () => {
      const brand = createBrand({
        sent_count: 100,
        bounce_count: 5,
        complaint_count: 1,
      });
      const snapshot = computeBrandHealthSnapshot(brand);

      expect(snapshot?.bounceRate).toBe(0.05);
      expect(snapshot?.complaintRate).toBe(0.01);
    });
  });
});

function createBrand(
  overrides: Partial<{
    is_paused: boolean;
    send_enabled: boolean;
    sent_count: number;
    bounce_count: number;
    complaint_count: number;
  }>,
) {
  return {
    id: "test-brand",
    sent_count: null,
    bounce_count: null,
    complaint_count: null,
    is_paused: null,
    send_enabled: null,
    ...overrides,
  };
}
