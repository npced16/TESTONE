import * as XLSX from "xlsx";
import { Buffer } from "buffer";

export type RowValue = string | number;

export type ParsedDataset = {
  name: string;
  columns: string[];
  rows: Record<string, RowValue>[];
};

export type Metric = {
  label: string;
  value: string;
  detail: string;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type AnalysisResult = {
  metrics: Metric[];
  insights: string[];
  reportDraft: string;
  chart: {
    title: string;
    points: ChartPoint[];
  };
};

type DocumentAsset = {
  name?: string | null;
  uri: string;
  fileCopyUri?: string | null;
};

type GeminiPayload = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
  };
};

export async function parseFileAsset(asset: DocumentAsset): Promise<ParsedDataset> {
  const name = asset.name ?? "uploaded-file";
  const extension = name.toLowerCase().split(".").pop();
  const buffer = await readAssetAsArrayBuffer(asset);
  if (extension === "xlsx") {
    return parseWorkbook(buffer, name);
  }
  const text = new TextDecoder("utf-8").decode(buffer);
  return parseTextDataset(text, name);
}

export function parseWorkbook(buffer: ArrayBuffer, name = "workbook.xlsx"): ParsedDataset {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("엑셀 시트를 찾지 못했습니다.");
  }
  const sheet = workbook.Sheets[sheetName];
  const table = XLSX.utils.sheet_to_json<RowValue[]>(sheet, { header: 1, blankrows: false, raw: true });
  return rowsFromTable(table, name);
}

export function parseTextDataset(text: string, name = "pasted-data"): ParsedDataset {
  const cleaned = text.trim();
  if (!cleaned) {
    throw new Error("분석할 데이터가 없습니다.");
  }
  const firstLine = cleaned.split(/\r?\n/)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const table = cleaned.split(/\r?\n/).map((line) => line.split(delimiter).map(coerceValue));
  return rowsFromTable(table, name);
}

export async function analyzeWithGemini(dataset: ParsedDataset, apiKey: string): Promise<AnalysisResult> {
  const fallbackChart = buildChart(dataset);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(dataset, fallbackChart) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      })
    }
  );
  const payload = (await response.json()) as GeminiPayload;
  if (!response.ok) {
    throw new Error(normalizeGeminiError(payload));
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new Error("Gemini 응답이 비어 있습니다.");
  }
  const generated = JSON.parse(text) as Partial<AnalysisResult>;
  return {
    metrics: normalizeMetrics(generated.metrics),
    insights: Array.isArray(generated.insights) ? generated.insights.map(String).slice(0, 5) : [],
    reportDraft: typeof generated.reportDraft === "string" ? generated.reportDraft : String(generated.reportDraft ?? ""),
    chart: fallbackChart
  };
}

function rowsFromTable(table: RowValue[][], name: string): ParsedDataset {
  const normalized = table.map(trimEmptyEdges).filter((row) => row.some((value) => value !== ""));
  if (normalized.length < 2) {
    throw new Error("표 헤더와 데이터 행이 필요합니다.");
  }
  const headerIndex = detectHeaderRow(normalized);
  const columns = normalized[headerIndex].map((value, index) => String(value || `Column ${index + 1}`).trim());
  const rows = normalized.slice(headerIndex + 1).map((values) => {
    const row: Record<string, RowValue> = {};
    columns.forEach((column, index) => {
      row[column] = coerceValue(values[index] ?? "");
    });
    return row;
  }).filter((row) => Object.values(row).some((value) => value !== ""));
  if (!rows.length) {
    throw new Error("분석할 데이터 행이 없습니다.");
  }
  return { name, columns, rows };
}

function detectHeaderRow(table: RowValue[][]): number {
  let bestIndex = 0;
  let bestScore = -Infinity;
  table.slice(0, -1).forEach((row, index) => {
    const width = row.filter((value) => value !== "").length;
    const textCount = row.filter((value) => typeof value === "string" && value.trim()).length;
    const uniqueCount = new Set(row.map(String).filter(Boolean)).size;
    const nextRows = table.slice(index + 1, index + 6);
    const numericBelow = nextRows.flat().filter((value) => typeof value === "number").length;
    const repeatedWidthBelow = nextRows.filter((nextRow) => nextRow.length >= Math.max(width, 2)).length;
    const score = textCount * 3 + uniqueCount + numericBelow * 2 + repeatedWidthBelow - index;
    if (width >= 2 && textCount >= 1 && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function buildChart(dataset: ParsedDataset): AnalysisResult["chart"] {
  const numericColumn = dataset.columns.find((column) => dataset.rows.some((row) => typeof row[column] === "number"));
  if (!numericColumn) {
    throw new Error("숫자 컬럼이 있는 엑셀 파일이 필요합니다.");
  }
  const labelColumn = dataset.columns.find((column) => column !== numericColumn) ?? dataset.columns[0];
  return {
    title: `${labelColumn}별 ${numericColumn}`,
    points: dataset.rows
      .filter((row) => typeof row[numericColumn] === "number")
      .slice(0, 12)
      .map((row, index) => ({
        label: String(row[labelColumn] || index + 1),
        value: Number(row[numericColumn])
      }))
  };
}

function buildPrompt(dataset: ParsedDataset, chart: AnalysisResult["chart"]): string {
  return `
너는 한국어 데이터 분석가다. 사용자가 올린 엑셀 데이터를 자동으로 분석한다.
컬럼 설정을 사용자에게 요구하지 말고, 표 안에서 가장 중요한 축과 수치를 직접 판단해라.
반드시 JSON만 반환해라.

반환 형식:
{
  "metrics": [
    {"label": "핵심 지표명", "value": "값", "detail": "짧은 설명"},
    {"label": "핵심 지표명", "value": "값", "detail": "짧은 설명"},
    {"label": "핵심 지표명", "value": "값", "detail": "짧은 설명"}
  ],
  "insights": ["인사이트 1", "인사이트 2", "인사이트 3"],
  "reportDraft": "결론과 시사점이 담긴 4문장 이내의 한국어 보고서 초안"
}

파일명: ${dataset.name}
컬럼: ${dataset.columns.join(", ")}
차트 후보: ${chart.title}
데이터 샘플(JSON): ${JSON.stringify(dataset.rows.slice(0, 40))}
`.trim();
}

function normalizeMetrics(metrics: unknown): Metric[] {
  if (!Array.isArray(metrics)) {
    throw new Error("Gemini 응답에 metrics 배열이 없습니다.");
  }
  return metrics.slice(0, 3).map((item) => {
    const metric = item as Partial<Metric>;
    return {
      label: String(metric.label ?? ""),
      value: String(metric.value ?? ""),
      detail: String(metric.detail ?? "")
    };
  });
}

function normalizeGeminiError(payload: GeminiPayload): string {
  const code = payload.error?.code;
  const message = payload.error?.message ?? "Gemini API 요청이 실패했습니다.";
  if (code === 429) {
    return "Gemini 사용량 한도를 초과했습니다. Google AI Studio의 quota/billing을 확인해주세요.";
  }
  if (code === 400 || code === 401 || code === 403) {
    return "Gemini API 키를 확인해주세요.";
  }
  return message;
}

async function readAssetAsArrayBuffer(asset: DocumentAsset): Promise<ArrayBuffer> {
  const uri = asset.fileCopyUri || asset.uri;
  const path = uri.replace(/^file:\/\//, "");
  const RNFS = require("react-native-fs") as {
    readFile(path: string, encoding: "base64"): Promise<string>;
  };
  const base64 = await RNFS.readFile(path, "base64");
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function trimEmptyEdges(row: RowValue[]): RowValue[] {
  let end = row.length;
  while (end > 0 && row[end - 1] === "") {
    end -= 1;
  }
  return row.slice(0, end);
}

function coerceValue(value: RowValue): RowValue {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return "";
  const numeric = Number(text.replaceAll(",", ""));
  return Number.isFinite(numeric) ? numeric : text;
}
