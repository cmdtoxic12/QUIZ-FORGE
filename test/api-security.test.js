const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_PASSWORD = "test-admin-password-with-strong-length";
process.env.JWT_SECRET = "test-only-secret-that-is-at-least-32-characters-long";
process.env.CORS_ORIGIN = "";

const app = require("../server/index");

test("admin access uses a short-lived token, not the password or query string", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(loginResponse.status, 200);
  const { token, expiresIn } = await loginResponse.json();
  assert.notEqual(token, process.env.ADMIN_PASSWORD);
  assert.equal(expiresIn, 900);

  const legacyQueryResponse = await fetch(
    `${baseUrl}/api/admin/stats?token=${encodeURIComponent(process.env.ADMIN_PASSWORD)}`,
  );
  assert.equal(legacyQueryResponse.status, 401);

  const forgedResponse = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { "x-admin-token": process.env.ADMIN_PASSWORD },
  });
  assert.equal(forgedResponse.status, 401);
});

test("cross-origin requests are rejected when no CORS origin is configured", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(response.status, 403);
});
