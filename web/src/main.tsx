import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnalysisResult,
  ParsedDataset,
  analyzeWithGemini,
  parseTextDataset,
  parseWorkbook
} from "../../src/lib/insight";
import "./styles.css";

type ChartType = "bar" | "line" | "table";

function App() {
  const [apiKey, setApiKey] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("엑셀 파일과 Gemini API 키를 넣으면 바로 분석합니다.");

  const canAnalyze = useMemo(() => Boolean(apiKey.trim() && dataset && !busy), [apiKey, busy, dataset]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setStatus("파일을 읽는 중입니다.");
    try {
      const extension = file.name.toLowerCase().split(".").pop();
      const parsed =
        extension === "xlsx"
          ? parseWorkbook(await file.arrayBuffer(), file.name)
          : parseTextDataset(await file.text(), file.name);
      setDataset(parsed);
      setPastedText("");
      setAnalysis(null);
      setStatus(`${parsed.name} 파일을 읽었습니다. ${parsed.rows.length}개 행을 분석할 수 있습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    }
  }

  function readPastedText() {
    try {
      const parsed = parseTextDataset(pastedText, "붙여넣기 데이터");
      setDataset(parsed);
      setAnalysis(null);
      setStatus(`${parsed.rows.length}개 행을 읽었습니다. Gemini 분석을 실행하세요.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "붙여넣기 데이터를 읽지 못했습니다.");
    }
  }

  async function runAnalysis() {
    if (!dataset || !apiKey.trim()) return;
    setBusy(true);
    setStatus("Gemini가 엑셀 내용을 분석하고 있습니다.");
    try {
      const result = await analyzeWithGemini(dataset, apiKey.trim());
      setAnalysis(result);
      setStatus("Gemini 분석이 완료되었습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gemini 분석에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const points = analysis?.chart.points ?? [];
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  return (
    <main className="page">
      <header className="header">
        <div>
          <p className="eyebrow">GITHUB PAGES · GEMINI DIRECT</p>
          <h1>데이터 인사이트 변환기</h1>
        </div>
        <p className="status">{status}</p>
      </header>

      <section className="grid">
        <aside className="panel">
          <PanelTitle number="1" title="엑셀 입력" text="브라우저에서 파일을 읽고 Gemini로 바로 분석합니다." />
          <label className="field">
            <span>Gemini API Key</span>
            <input
              type="password"
              value={apiKey}
              placeholder="AIza..."
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="upload">
            <input
              type="file"
              accept=".xlsx,.csv,.tsv,text/csv,text/plain"
              onChange={(event) => void handleFile(event.currentTarget.files?.[0] ?? null)}
            />
            엑셀/CSV 파일 올리기
          </label>
          <div className="divider">또는 표 데이터를 붙여넣기</div>
          <textarea
            value={pastedText}
            placeholder={"월,매출,고객수\n1월,12400000,320\n2월,14200000,351"}
            onChange={(event) => setPastedText(event.target.value)}
          />
          <button className="ghost" onClick={readPastedText}>
            붙여넣기 데이터 읽기
          </button>
        </aside>

        <section className="panel result">
          <div className="result-header">
            <PanelTitle number="2" title="자동 분석" text="컬럼 설정 없이 Gemini가 핵심 지표와 보고서를 만듭니다." />
            <button className="run" disabled={!canAnalyze} onClick={() => void runAnalysis()}>
              {busy ? "분석 중" : "분석 실행"}
            </button>
          </div>

          {analysis ? (
            <>
              <div className="metrics">
                {analysis.metrics.map((metric) => (
                  <article key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </article>
                ))}
              </div>

              <div className="tabs">
                {(["bar", "line", "table"] as ChartType[]).map((type) => (
                  <button
                    key={type}
                    className={chartType === type ? "active" : ""}
                    onClick={() => setChartType(type)}
                  >
                    {type === "bar" ? "막대" : type === "line" ? "추세" : "표"}
                  </button>
                ))}
              </div>

              <div className="chart">
                {chartType === "table"
                  ? points.map((point) => (
                      <div className="table-row" key={point.label}>
                        <span>{point.label}</span>
                        <strong>{point.value.toLocaleString("ko-KR")}</strong>
                      </div>
                    ))
                  : points.map((point, index) => (
                      <div className="bar-row" key={point.label}>
                        <span>{point.label}</span>
                        <div className="bar-track">
                          <div
                            className={chartType === "line" ? "bar-fill line" : "bar-fill"}
                            style={{
                              width: `${Math.max((point.value / maxValue) * 100, 4)}%`,
                              opacity: chartType === "line" ? 0.55 + index / Math.max(points.length * 2, 1) : 1
                            }}
                          />
                        </div>
                        <strong>{point.value.toLocaleString("ko-KR")}</strong>
                      </div>
                    ))}
              </div>

              <section className="report">
                <h2>보고서 초안</h2>
                <p>{analysis.reportDraft}</p>
              </section>
            </>
          ) : (
            <div className="empty">
              <strong>분석 결과 대기 중</strong>
              <span>파일을 올리고 API 키를 입력하면 Gemini가 바로 분석합니다.</span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function PanelTitle({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="panel-title">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
