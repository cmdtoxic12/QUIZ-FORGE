const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanTextInput, safeFilename } = require("../server/lib/security");
const { validateCredentials } = require("../server/lib/auth");

test("input helpers remove nulls and path separators", () => {
  assert.equal(cleanTextInput("  hi\0 there  "), "hi there");
  assert.equal(safeFilename("../unsafe\\name.pdf"), ".._unsafe_name.pdf");
});

test("credential validation bounds email and bcrypt input sizes", () => {
  assert.equal(
    validateCredentials({ email: "  STUDENT@example.com ", password: "long-password" }).email,
    "student@example.com",
  );
  assert.throws(() =>
    validateCredentials({ email: "a".repeat(250) + "@example.com", password: "long-password" }),
  );
  assert.throws(() =>
    validateCredentials({ email: "student@example.com", password: "é".repeat(37) }),
  );
});
