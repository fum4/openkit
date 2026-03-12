import { isMcpSetupEnabled } from "./feature-flags";

describe("isMcpSetupEnabled", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENKIT_ENABLE_MCP_SETUP;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns false when env var is not set", () => {
    expect(isMcpSetupEnabled()).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "";

    expect(isMcpSetupEnabled()).toBe(false);
  });

  it("returns true when env var is '1'", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "1";

    expect(isMcpSetupEnabled()).toBe(true);
  });

  it("returns true when env var is 'true'", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "true";

    expect(isMcpSetupEnabled()).toBe(true);
  });

  it("returns true when env var is 'yes'", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "yes";

    expect(isMcpSetupEnabled()).toBe(true);
  });

  it("returns true when env var is 'on'", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "on";

    expect(isMcpSetupEnabled()).toBe(true);
  });

  it("returns true when env var has uppercase and whitespace", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "  TRUE  ";

    expect(isMcpSetupEnabled()).toBe(true);
  });

  it("returns false when env var is '0'", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "0";

    expect(isMcpSetupEnabled()).toBe(false);
  });

  it("returns false when env var is 'false'", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "false";

    expect(isMcpSetupEnabled()).toBe(false);
  });

  it("returns false when env var is arbitrary text", () => {
    process.env.OPENKIT_ENABLE_MCP_SETUP = "maybe";

    expect(isMcpSetupEnabled()).toBe(false);
  });
});
