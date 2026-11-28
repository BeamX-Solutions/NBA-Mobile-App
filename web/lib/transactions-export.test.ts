import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransactionsCsv,
  exportFilename,
  fetchTransactionsForExport,
  lagosCell,
  lagosRange,
  nairaCell,
  type ExportRow,
} from "./transactions-export.ts";

const row: ExportRow = {
  id: "96e8931a-3578-46b0-8109-620f2f1baefd",
  invoice_number: "TXN-AN-00017-DOA",
  rbin: "NBA/ANAOCHA/0017/2026",
  document_type: "deed_of_assignment",
  parties: 'Okafor, Chinedu to "Adeola" Properties Ltd',
  property_description: "Plot 14, Block C",
  consideration: 3_500_000_000,
  amount_payable: 350_000_050,
  branch_fee: 7_000_001,
  due_to_practitioner: 343_000_049,
  remitted_at: null,
  status: "verified",
  created_at: "2026-11-27T15:30:00Z",
  verified_at: "2026-11-27T23:10:00Z",
  branches: { name: "NBA Anaocha Branch" },
  profiles: { full_name: "Emeka Practitioner", scn: "SCN/1" },
  certificates: { certificate_number: "NBA/AN/CC/2026/00017", issued_at: "2026-11-27T23:10:00Z", revoked_at: null, revocation_reason: null },
};

test("a period covers both whole Lagos days, and refuses a backwards or malformed one", () => {
  assert.deepEqual(lagosRange("2026-11-01", "2026-11-30"), {
    start: "2026-10-31T23:00:00.000Z",
    end: "2026-11-30T23:00:00.000Z",
  });
  assert.deepEqual(lagosRange("2026-11-27", "2026-11-27"), {
    start: "2026-11-26T23:00:00.000Z",
    end: "2026-11-27T23:00:00.000Z",
  });
  assert.deepEqual(lagosRange("2026-12-01", "2026-12-31")?.end, "2026-12-31T23:00:00.000Z");
  assert.equal(lagosRange("2026-11-30", "2026-11-01"), null);
  assert.equal(lagosRange("1/11/2026", "2026-11-30"), null);
  assert.equal(lagosRange("", ""), null);
});

test("amounts are naira with two decimals, dates Lagos local time", () => {
  assert.equal(nairaCell(350_000_050), "3500000.50");
  assert.equal(nairaCell(0), "0.00");
  assert.equal(nairaCell(7), "0.07");
  assert.equal(lagosCell("2026-11-27T23:10:00Z"), "2026-11-28 00:10");
  assert.equal(lagosCell(null), "");
  assert.equal(lagosCell("not a date"), "");
});

test("the spreadsheet has a header, one quoted line per row, and opens as UTF-8 in Excel", () => {
  const csv = buildTransactionsCsv([row]);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^"Invoice","Branch","Practitioner"/);
  assert.match(lines[0], /"Client pays \(₦\)"/);
  assert.match(lines[1], /"Okafor, Chinedu to ""Adeola"" Properties Ltd"/);
  assert.match(lines[1], /"Deed of Assignment"/);
  assert.match(lines[1], /"3500000.50"/);
  assert.match(lines[1], /"Verified"/);
  assert.match(lines[1], /"2026-11-27 16:30"/);
  assert.match(lines[1], /"NBA Anaocha Branch"/);
  assert.equal(buildTransactionsCsv([]).slice(1).trimEnd().split("\r\n").length, 1);
});

test("text that a spreadsheet would run as a formula is shown as text", () => {
  const csv = buildTransactionsCsv([{ ...row, parties: "=HYPERLINK(\"http://x\")", property_description: "+234 Road" }]);
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.match(csv, /"'\+234 Road"/);
});

test("the filename names the period", () => {
  assert.equal(exportFilename("2026-11-01", "2026-11-30"), "nba-transactions-2026-11-01-to-2026-11-30.csv");
  assert.equal(exportFilename("2026-11-27", "2026-11-27"), "nba-transactions-2026-11-27.csv");
});

test("more than 1,000 rows are fetched page by page, within the period, oldest first", async () => {
  const calls: { gte: string; lt: string; order: boolean; from: number; to: number }[] = [];
  const total = 2_345;
  const from = () => ({
    select: () => ({
      gte: (_c: string, gte: string) => ({
        lt: (_d: string, lt: string) => ({
          order: (_e: string, { ascending }: { ascending: boolean }) => ({
            range: async (start: number, end: number) => {
              calls.push({ gte, lt, order: ascending, from: start, to: end });
              const count = Math.max(0, Math.min(end, total - 1) - start + 1);
              return { data: Array.from({ length: count }, (_, i) => ({ ...row, id: String(start + i) })), error: null };
            },
          }),
        }),
      }),
    }),
  });
  const rows = await fetchTransactionsForExport(from, { start: "S", end: "E" });
  assert.equal(rows.length, total);
  assert.deepEqual(calls.map((c) => [c.from, c.to]), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.ok(calls.every((c) => c.gte === "S" && c.lt === "E" && c.order === true));
});

test("a failed page is reported, not saved as a short file", async () => {
  const from = () => ({
    select: () => ({ gte: () => ({ lt: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: "permission denied" } }) }) }) }) }),
  });
  await assert.rejects(fetchTransactionsForExport(from, { start: "S", end: "E" }), /permission denied/);
});
