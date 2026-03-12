import { validateBranchName } from "./git";

describe("validateBranchName", () => {
  it("accepts simple branch names", () => {
    expect(validateBranchName("main")).toBe(true);
    expect(validateBranchName("develop")).toBe(true);
    expect(validateBranchName("feature")).toBe(true);
  });

  it("accepts branch names with slashes", () => {
    expect(validateBranchName("feature/login")).toBe(true);
    expect(validateBranchName("PROJ-123/fix-bug")).toBe(true);
  });

  it("accepts branch names with dots, hyphens, and underscores", () => {
    expect(validateBranchName("release-1.0")).toBe(true);
    expect(validateBranchName("feature_test")).toBe(true);
    expect(validateBranchName("v2.0.0-beta")).toBe(true);
  });

  it("rejects branch names starting with non-alphanumeric", () => {
    expect(validateBranchName(".hidden")).toBe(false);
    expect(validateBranchName("-dashed")).toBe(false);
    expect(validateBranchName("_underscore")).toBe(false);
    expect(validateBranchName("/slash")).toBe(false);
  });

  it("rejects branch names containing double dots", () => {
    expect(validateBranchName("feature..lock")).toBe(false);
    expect(validateBranchName("a..b")).toBe(false);
  });

  it("rejects branch names with spaces", () => {
    expect(validateBranchName("feature branch")).toBe(false);
  });

  it("rejects branch names with special characters", () => {
    expect(validateBranchName("feature~1")).toBe(false);
    expect(validateBranchName("feature^2")).toBe(false);
    expect(validateBranchName("feature:ref")).toBe(false);
    expect(validateBranchName("feature?glob")).toBe(false);
    expect(validateBranchName("feature*all")).toBe(false);
    expect(validateBranchName("feature[0]")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateBranchName("")).toBe(false);
  });
});
