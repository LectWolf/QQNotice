import { describe, expect, it } from "vitest";
import { signToken, verifyToken, InvalidTokenError } from "./jwt.js";

const secret = "test-secret";

describe("jwt", () => {
  it("signs a payload that round-trips through verifyToken", () => {
    const token = signToken({ sub: 42, isOperator: true }, secret);

    expect(verifyToken(token, secret)).toMatchObject({
      sub: 42,
      isOperator: true,
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signToken({ sub: 42, isOperator: false }, secret);

    expect(() => verifyToken(token, "wrong-secret")).toThrow(InvalidTokenError);
  });

  it("rejects a structurally invalid token", () => {
    expect(() => verifyToken("garbage", secret)).toThrow(InvalidTokenError);
  });

  it("rejects an expired token", () => {
    const token = signToken({ sub: 42, isOperator: false }, secret, {
      expiresInSeconds: -1, // already expired
    });

    expect(() => verifyToken(token, secret)).toThrow(InvalidTokenError);
  });
});
