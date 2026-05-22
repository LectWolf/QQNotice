import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "./password.js";
import { bootstrapOperator } from "./bootstrapOperator.js";
import { getTestPrisma, resetDb } from "../../test/db.js";

describe("bootstrapOperator", () => {
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does nothing when no user matches the admin username", async () => {
    const updated = await bootstrapOperator(prisma, "missing");
    expect(updated).toBe(false);
  });

  it("promotes the matching user to isOperator on the first run", async () => {
    await prisma.user.create({
      data: {
        username: "lectwolf",
        passwordHash: await hashPassword("hunter2hunter2", 4),
      },
    });

    const updated = await bootstrapOperator(prisma, "lectwolf");
    expect(updated).toBe(true);

    const user = await prisma.user.findUnique({
      where: { username: "lectwolf" },
    });
    expect(user!.isOperator).toBe(true);
  });

  it("is idempotent: a second run on an already-operator user is a no-op", async () => {
    await prisma.user.create({
      data: {
        username: "lectwolf",
        passwordHash: await hashPassword("hunter2hunter2", 4),
        isOperator: true,
      },
    });

    const updated = await bootstrapOperator(prisma, "lectwolf");
    expect(updated).toBe(false);
  });

  it("does not touch any other user's isOperator flag", async () => {
    await prisma.user.create({
      data: {
        username: "lectwolf",
        passwordHash: await hashPassword("hunter2hunter2", 4),
      },
    });
    await prisma.user.create({
      data: {
        username: "bystander",
        passwordHash: await hashPassword("hunter2hunter2", 4),
      },
    });

    await bootstrapOperator(prisma, "lectwolf");

    const bystander = await prisma.user.findUnique({
      where: { username: "bystander" },
    });
    expect(bystander!.isOperator).toBe(false);
  });
});
