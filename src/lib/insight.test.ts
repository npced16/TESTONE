import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTextDataset, parseWorkbook } from "./insight";

describe("frontend-only dataset parsing", () => {
  it("detects a table after title rows in pasted text", () => {
    const dataset = parseTextDataset(`월간 리포트
작성일,2026-05-27

월,매출,고객수
1월,1000,10
2월,2500,14`);

    expect(dataset.columns).toEqual(["월", "매출", "고객수"]);
    expect(dataset.rows[1].매출).toBe(2500);
  });

  it("parses xlsx workbooks without backend help", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["월간 리포트", "", ""],
      ["작성일", "2026-05-27", ""],
      [],
      ["월", "매출", "고객수"],
      ["1월", 1000, 10],
      ["2월", 2500, 14]
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const dataset = parseWorkbook(buffer, "sample.xlsx");

    expect(dataset.columns).toEqual(["월", "매출", "고객수"]);
    expect(dataset.rows).toHaveLength(2);
  });
});
