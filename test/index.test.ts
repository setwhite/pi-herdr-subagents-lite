import { expect, it } from "vitest";
import extension from "../src/index.ts";

it("exports the extension factory", () => {
  expect(typeof extension).toBe("function");
});
