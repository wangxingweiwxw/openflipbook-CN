import { describe, expect, it } from "vitest";
import { subjectEchoesParent } from "./subject-echo";

describe("subjectEchoesParent", () => {
  it("flags exact parent-title restatement (stuck-trail mode)", () => {
    const title = "崇祯皇帝与大明王朝的落幕";
    expect(subjectEchoesParent(title, title, "明朝崇祯皇帝")).toBe(true);
  });

  it("flags empty subject", () => {
    expect(subjectEchoesParent("", "Steam Engine")).toBe(true);
  });

  it("allows a local detail under a long poetic parent title", () => {
    expect(
      subjectEchoesParent(
        "龙袍",
        "明思宗崇祯皇帝：大明王朝的终章",
        "明朝崇祯皇帝",
      ),
    ).toBe(false);
  });

  it("flags seed-query echo", () => {
    expect(
      subjectEchoesParent("明朝崇祯皇帝", "明思宗崇祯皇帝：大明王朝的终章", "明朝崇祯皇帝"),
    ).toBe(true);
  });

  it("allows a distinct English component subject", () => {
    expect(
      subjectEchoesParent("Boiler pressure gauge", "Steam Engine", "how does a steam engine work"),
    ).toBe(false);
  });
});
