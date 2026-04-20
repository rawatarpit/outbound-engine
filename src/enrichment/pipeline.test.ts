import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentResultStatus } from "../agents/types";

describe("Agent Types", () => {
  describe("AgentResultStatus", () => {
    it("should have correct status values", () => {
      expect(AgentResultStatus.SUCCESS).toBe("SUCCESS");
      expect(AgentResultStatus.RETRYABLE_FAILURE).toBe("RETRYABLE_FAILURE");
      expect(AgentResultStatus.TERMINAL_FAILURE).toBe("TERMINAL_FAILURE");
      expect(AgentResultStatus.SKIPPED).toBe("SKIPPED");
    });
  });

  describe("result helper functions", async () => {
    const { success, retryableFailure, terminalFailure, skipped } =
      await import("../agents/types");

    it("should create success result", () => {
      const result = success({ fitScore: 85 });
      expect(result.status).toBe(AgentResultStatus.SUCCESS);
      expect(result.data).toEqual({ fitScore: 85 });
    });

    it("should create retryable failure result", () => {
      const result = retryableFailure("Network timeout");
      expect(result.status).toBe(AgentResultStatus.RETRYABLE_FAILURE);
      expect(result.error).toBe("Network timeout");
    });

    it("should create terminal failure result", () => {
      const result = terminalFailure("Missing required data");
      expect(result.status).toBe(AgentResultStatus.TERMINAL_FAILURE);
      expect(result.error).toBe("Missing required data");
    });

    it("should create skipped result", () => {
      const result = skipped("Already processed");
      expect(result.status).toBe(AgentResultStatus.SKIPPED);
      expect(result.error).toBe("Already processed");
    });
  });
});

describe("Enrichment Pipeline", () => {
  describe("validateEnrichedData", async () => {
    const { validateEnrichedData } =
      await import("../enrichment/utils/validators");

    it("should return invalid for null data", () => {
      expect(validateEnrichedData(null as any).valid).toBe(false);
      expect(validateEnrichedData(undefined as any).valid).toBe(false);
    });

    it("should return invalid for invalid email", () => {
      const result = validateEnrichedData({ email: "invalid-email" } as any);
      expect(result.valid).toBe(false);
    });

    it("should return invalid for confidence out of range", () => {
      expect(
        validateEnrichedData({
          email: "test@test.com",
          confidence: -0.1,
        } as any).valid,
      ).toBe(false);
      expect(
        validateEnrichedData({ email: "test@test.com", confidence: 1.5 } as any)
          .valid,
      ).toBe(false);
    });

    it("should return valid for correct data", () => {
      const result = validateEnrichedData({
        email: "test@test.com",
        confidence: 0.8,
        strategy: "API_ENRICHMENT",
      } as any);
      expect(result.valid).toBe(true);
    });
  });

  describe("EnrichmentStatus", async () => {
    const { EnrichmentStatus } = await import("../enrichment/types");

    it("should have correct status values", () => {
      expect(EnrichmentStatus.SUCCESS).toBe("SUCCESS");
      expect(EnrichmentStatus.PARTIAL).toBe("PARTIAL");
      expect(EnrichmentStatus.FAILED).toBe("FAILED");
      expect(EnrichmentStatus.SKIPPED).toBe("SKIPPED");
    });
  });
});

describe("Suppression Engine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should export required functions", async () => {
    const { isSuppressed, suppressCompany } =
      await import("../reputation/suppressionEngine");
    expect(typeof isSuppressed).toBe("function");
    expect(typeof suppressCompany).toBe("function");
  });
});

describe("Throttle Engine", () => {
  it("should export checkRampLimit function", async () => {
    const { checkRampLimit } = await import("../reputation/throttleEngine");
    expect(typeof checkRampLimit).toBe("function");
  });
});

describe("Backoff Engine", () => {
  it("should export required functions", async () => {
    const { getBackoffDelay, recordSoftFailure, resetBackoff } =
      await import("../reputation/backoffEngine");
    expect(typeof getBackoffDelay).toBe("function");
    expect(typeof recordSoftFailure).toBe("function");
    expect(typeof resetBackoff).toBe("function");
  });
});

describe("Bounce Classifier", () => {
  it("should classify hard bounces", async () => {
    const { classifyBounce } = await import("../reputation/bounceClassifier");

    expect(classifyBounce("550 Mailbox unavailable")).toBe("hard");
    expect(classifyBounce("550 User unknown")).toBe("hard");
    expect(classifyBounce("550 No such user")).toBe("hard");
  });

  it("should classify soft bounces", async () => {
    const { classifyBounce } = await import("../reputation/bounceClassifier");

    expect(classifyBounce("450 Temporary failure")).toBe("soft");
    expect(classifyBounce("421 Service unavailable")).toBe("soft");
    expect(classifyBounce("450 Greylisted")).toBe("soft");
  });
});
