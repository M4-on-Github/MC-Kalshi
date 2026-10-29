import { describe, expect, it } from "vitest";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  it("reports unconfigured with 200 when no database check is available", async () => {
    const result = await buildHealth({ dbCheck: undefined, commit: "abc123" });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, db: "unconfigured", commit: "abc123" },
    });
  });

  it("defaults the commit to 'dev' when none is given", async () => {
    const result = await buildHealth({ dbCheck: undefined });
    expect(result.body.commit).toBe("dev");
  });

  it("reports ok with 200 when the database check resolves", async () => {
    const result = await buildHealth({ dbCheck: async () => {}, commit: "abc123" });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, db: "ok", commit: "abc123" },
    });
  });

  it("reports error with 503 and leaks nothing when the database check rejects", async () => {
    const secret = "postgres://user:hunter2@db.example.com:5432/app";
    const result = await buildHealth({
      dbCheck: async () => {
        throw new Error(`connection refused for ${secret}`);
      },
      commit: "abc123",
    });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, db: "error", commit: "abc123" });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("connection refused");
  });

  it("treats a database check that hangs past the timeout as an error", async () => {
    const result = await buildHealth({
      dbCheck: () => new Promise<void>(() => {}),
      commit: "abc123",
      timeoutMs: 20,
    });
    expect(result.status).toBe(503);
    expect(result.body.db).toBe("error");
  });
});
