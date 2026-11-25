import { describe, expect, it } from "vitest";
import { recognizeAlert } from "../src/ui/alertText";

describe("recognizeAlert (texts seen on the real printer)", () => {
  it("recognises toner warnings, including 'do not replace until instructed'", () => {
    expect(recognizeAlert("The Yellow Toner [Y] Cartridge needs to be replaced soon. Order a new Yellow Toner [Y] Cartridge. Printing can continue.")).toEqual({
      key: "tonerReplaceSoon",
      color: "yellow",
      waitForInstruction: false,
    });
    expect(
      recognizeAlert("The Magenta Toner [M] Cartridge needs to be replaced soon. Order a new Magenta Toner [M] Cartridge but do not replace until you are instructed to. Printing can continue."),
    ).toEqual({ key: "tonerReplaceSoon", color: "magenta", waitForInstruction: true });
  });

  it("recognises known parts at end of life", () => {
    expect(recognizeAlert("The Transfer Belt Cleaner has reached end of life. Call your System Administrator to replace the Transfer Belt Cleaner. Printing can continue.")).toEqual({
      key: "partEndOfLife",
      part: "transferBeltCleaner",
    });
  });

  it("leaves anything else untranslated", () => {
    expect(recognizeAlert("The Fuser Unit has reached end of life.")).toBeNull();
    expect(recognizeAlert("Paper jam in Tray 1.")).toBeNull();
  });
});
