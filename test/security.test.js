const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanTextInput, safeFilename } = require("../server/lib/security");

test("input helpers remove nulls and path separators", () => {
  assert.equal(cleanTextInput("  hi\0 there  "), "hi there");
  assert.equal(safeFilename("../unsafe\\name.pdf"), ".._unsafe_name.pdf");
});
