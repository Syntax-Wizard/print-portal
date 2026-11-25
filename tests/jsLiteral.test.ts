import { describe, expect, it } from "vitest";
import { JsLiteralError, parseJsLiteral, parseJsLiteralAt } from "../src/printer/jsLiteral";
import { decodeEntities, extractConcatenated, extractVar } from "../src/printer/html";

describe("parseJsLiteral", () => {
  it("parses nested arrays of strings and numbers", () => {
    expect(parseJsLiteral("[['トレイ1',0,100,'A4'],['x',-3,1.5]]")).toEqual([
      ["トレイ1", 0, 100, "A4"],
      ["x", -3, 1.5],
    ]);
  });

  it("parses empty arrays, booleans, null and whitespace", () => {
    expect(parseJsLiteral(" [ [], true , false,null ] ")).toEqual([[], true, false, null]);
  });

  it("handles escapes in both quote styles", () => {
    expect(parseJsLiteral(String.raw`['it\'s', "a \"b\"", 'tab\there', 'あ\x41', 'back\\slash']`)).toEqual([
      "it's",
      'a "b"',
      "tab\there",
      "あA",
      "back\\slash",
    ]);
  });

  it("tolerates a trailing comma", () => {
    expect(parseJsLiteral("[1,2,]")).toEqual([1, 2]);
  });

  it("rejects anything that is not a plain literal", () => {
    for (const bad of ["[alert(1)]", "['a'+'b']", "[1 2]", "['unterminated]", "[1]; evil()", "{a:1}"]) {
      expect(() => parseJsLiteral(bad), bad).toThrow(JsLiteralError);
    }
  });

  it("reports where a literal ends inside a larger source", () => {
    const src = "var a=[1,[2]];var b=3;";
    expect(parseJsLiteralAt(src, 6)).toEqual({ value: [1, [2]], end: 13 });
  });
});

describe("html helpers", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("g/m&sup2; &quot;x&quot; &#65;&#x42; &unknown;")).toBe('g/m² "x" AB &unknown;');
  });

  it("extracts a variable without matching longer names", () => {
    const html = "var infoIn=[1];\nvar info=[2];";
    expect(extractVar(html, "info")).toEqual([2]);
    expect(extractVar(html, "infoIn")).toEqual([1]);
    expect(extractVar(html, "missing")).toBeUndefined();
  });

  it("collects incrementally built arrays", () => {
    const html = "var info = [];\ninfo=info.concat([['a',1]]);\nfoo();\ninfo=info.concat([['b',2]]);";
    expect(extractConcatenated(html, "info")).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
});
