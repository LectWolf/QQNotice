import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes a plaintext to a verifiable bcrypt string", async () => {
    const hash = await hashPassword("hunter2", 4);

    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("rejects the wrong plaintext", async () => {
    const hash = await hashPassword("hunter2", 4);
    expect(await verifyPassword("hunter3", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("produces different hashes for the same plaintext (salted)", async () => {
    const a = await hashPassword("hunter2", 4);
    const b = await hashPassword("hunter2", 4);
    expect(a).not.toBe(b);
    expect(await verifyPassword("hunter2", a)).toBe(true);
    expect(await verifyPassword("hunter2", b)).toBe(true);
  });
});
