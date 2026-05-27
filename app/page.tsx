"use client";

import { Download, FileSpreadsheet, Play, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import styles from "./page.module.css";

const API_BASE_URL = "http://127.0.0.1:8000";

type ChartType = "bar" | "line" | "pie" | "table";

type Metric = {
  label: string;
  value: string;
  detail: string;
};

type ChartPoint = {
  label: string;
  value: number;
};

type AnalyzeResponse = {
  dataset_id: string;
  metrics: Metric[];
  insights: string[];
  default_chart_type: ChartType;
  chart_data_model: {
    title: string;
    points: ChartPoint[];
  };
  report_draft: string;
  analysis_notice?: string;
  analysis_source?: string;
};

export default function Home() {
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [status, setStatus] = useState("파일을 올리거나 표 데이터를 붙여넣으세요.");
  const [busy, setBusy] = useState(false);

  const points = analysis?.chart_data_model.points ?? [];

  const canAnalyze = useMemo(() => (rawText.trim().length > 0 || file) && apiKey.trim().length > 0, [apiKey, file, rawText]);

  async function analyze() {
    if (!canAnalyze) return;
    setBusy(true);
    setStatus("데이터를 분석하고 있습니다.");
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      if (!file) form.append("text", rawText);

      const ingestResponse = await fetch(`${API_BASE_URL}/api/ingest`, {
        method: "POST",
        body: form
      });
      if (!ingestResponse.ok) throw new Error("데이터 입력 처리에 실패했습니다.");
      const ingest = await ingestResponse.json();

      const analyzeResponse = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: ingest.dataset_id,
          gemini_api_key: apiKey.trim()
        })
      });
      if (!analyzeResponse.ok) {
        const detail = await analyzeResponse.json().catch(() => null);
        throw new Error(detail?.detail ?? "분석 생성에 실패했습니다.");
      }
      const result = (await analyzeResponse.json()) as AnalyzeResponse;

      setAnalysis(result);
      setChartType(result.default_chart_type);
      setStatus(result.analysis_notice ?? "분석이 완료되었습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportFile(format: "xlsx" | "pdf" | "docx") {
    if (!analysis) return;
    setStatus(`${format.toUpperCase()} 파일을 생성하고 있습니다.`);
    const response = await fetch(`${API_BASE_URL}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: analysis.dataset_id,
        format,
        selected_chart_type: chartType
      })
    });
    if (!response.ok) {
      setStatus("파일 생성에 실패했습니다.");
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `insight-report.${format}`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatus(`${format.toUpperCase()} 파일이 생성되었습니다.`);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DATA INSIGHT CONVERTER</p>
          <h1>데이터 인사이트 변환기</h1>
        </div>
        <p className={styles.status}>{status}</p>
      </header>

      <section className={styles.workspace} aria-label="분석 작업 영역">
        <aside className={styles.inputPanel}>
          <PanelTitle number="1" title="엑셀 업로드" text="파일만 올리면 Gemini가 표 구조와 핵심 수치를 자동으로 판단합니다." />
          <label className={styles.apiKeyField}>
            <span>Gemini API Key</span>
            <input
              type="password"
              value={apiKey}
              placeholder="AIza..."
              onChange={(event) => {
                setApiKey(event.target.value);
                setStatus("Gemini API 키와 데이터를 입력하면 분석할 수 있습니다.");
              }}
            />
          </label>
          <textarea
            id="data-input"
            aria-label="데이터 붙여넣기"
            placeholder={"월,매출,고객수\n1월,12400000,320\n2월,14200000,351"}
            value={rawText}
            onChange={(event) => {
              setRawText(event.target.value);
              setAnalysis(null);
              if (file) setFile(null);
              setStatus("붙여넣은 데이터를 분석할 준비가 되었습니다.");
            }}
            rows={13}
          />
          <div className={styles.actions}>
            <label className={styles.fileButton}>
              <Upload size={18} />
              <span>{file ? file.name : "엑셀/CSV 올리기"}</span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  setAnalysis(null);
                  if (selected) {
                    setRawText("");
                    setStatus(`${selected.name} 파일을 분석할 준비가 되었습니다.`);
                  }
                }}
              />
            </label>
            <button className={styles.primary} disabled={!canAnalyze || busy} onClick={analyze}>
              <Play size={18} />
              분석 실행
            </button>
          </div>
        </aside>

        <section className={styles.resultBlock}>
          <div className={styles.resultHeader}>
            <PanelTitle number="2" title="자동 분석 결과" text="컬럼 설정 없이 핵심 수치, 차트, 보고서 초안을 생성합니다." />
            <select value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>
              <option value="bar">막대 차트</option>
              <option value="line">선 차트</option>
              <option value="pie">파이 차트</option>
              <option value="table">테이블</option>
            </select>
          </div>

          {analysis ? (
            <>
              <div className={styles.metrics}>
                {analysis.metrics.map((metric) => (
                  <article key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </article>
                ))}
              </div>
              <div className={styles.chartBox}>{renderChart(chartType, points)}</div>
              <section className={styles.reportPanel}>
                <h3>보고서 초안</h3>
                <p>{analysis.report_draft}</p>
              </section>
            </>
          ) : (
            <div className={styles.emptyState}>
              <FileSpreadsheet size={36} />
              <p>분석을 실행하면 결과가 표시됩니다.</p>
            </div>
          )}
        </section>

        <aside className={styles.exportBlock}>
          <PanelTitle number="3" title="파일 저장" text="선택한 차트 기준으로 보고서를 내보냅니다." />
          <div className={styles.exportButtons}>
            {(["xlsx", "pdf", "docx"] as const).map((format) => (
              <button key={format} disabled={!analysis} onClick={() => exportFile(format)}>
                <Download size={17} />
                {format.toUpperCase()}
              </button>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

function PanelTitle({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className={styles.panelTitle}>
      <span className={styles.stepBadge}>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

function renderChart(type: ChartType, points: ChartPoint[]) {
  if (type === "table") {
    return (
      <table className={styles.dataTable}>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th>{point.label}</th>
              <td>{point.value.toLocaleString("ko-KR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={points} dataKey="value" nameKey="label" outerRadius={92} label>
            {points.map((point, index) => (
              <Cell key={point.label} fill={["#2563eb", "#0f766e", "#f59e0b", "#dc2626", "#7c3aed"][index % 5]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={250}>
        <ReLineChart data={points}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Line dataKey="value" stroke="#0f766e" strokeWidth={3} />
        </ReLineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={points}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
