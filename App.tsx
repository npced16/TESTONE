import { pick } from "@react-native-documents/picker";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  AnalysisResult,
  ParsedDataset,
  analyzeWithGemini,
  parseFileAsset,
  parseTextDataset
} from "./src/lib/insight";

type ChartType = "bar" | "line" | "table";

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [status, setStatus] = useState("엑셀 파일과 Gemini API 키를 넣으면 바로 분석합니다.");
  const [busy, setBusy] = useState(false);

  const canAnalyze = useMemo(() => Boolean(apiKey.trim() && dataset), [apiKey, dataset]);

  async function pickFile() {
    setStatus("파일을 여는 중입니다.");
    try {
      const [asset] = await pick({
        allowMultiSelection: false,
        mode: "import",
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/csv",
          "text/tab-separated-values",
          "text/plain"
        ]
      });
      const parsed = await parseFileAsset(asset);
      setDataset(parsed);
      setPastedText("");
      setAnalysis(null);
      setStatus(`${parsed.name} 파일을 읽었습니다. ${parsed.rows.length}개 행을 분석할 수 있습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "파일 선택이 취소되었거나 파일을 읽지 못했습니다.");
    }
  }

  function usePastedText() {
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

  const chartPoints = analysis?.chart.points ?? [];
  const maxValue = Math.max(...chartPoints.map((point) => point.value), 1);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>RN · GEMINI DIRECT</Text>
            <Text style={styles.title}>데이터 인사이트 변환기</Text>
          </View>
          <Text style={styles.status}>{status}</Text>
        </View>

        <View style={styles.grid}>
          <View style={styles.panel}>
            <PanelTitle number="1" title="엑셀 입력" text="백엔드 없이 앱에서 파일을 읽고 Gemini로 바로 보냅니다." />
            <Text style={styles.label}>Gemini API Key</Text>
            <TextInput
              secureTextEntry
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="AIza..."
              placeholderTextColor="#8b95a1"
              style={styles.input}
            />
            <Pressable style={styles.primaryButton} onPress={pickFile}>
              <Text style={styles.primaryButtonText}>엑셀/CSV 파일 올리기</Text>
            </Pressable>
            <Text style={styles.orText}>또는 표 데이터를 붙여넣기</Text>
            <TextInput
              multiline
              value={pastedText}
              onChangeText={setPastedText}
              placeholder={"월,매출,고객수\n1월,12400000,320\n2월,14200000,351"}
              placeholderTextColor="#8b95a1"
              style={[styles.input, styles.textArea]}
            />
            <Pressable style={styles.secondaryButton} onPress={usePastedText}>
              <Text style={styles.secondaryButtonText}>붙여넣기 데이터 읽기</Text>
            </Pressable>
          </View>

          <View style={[styles.panel, styles.resultPanel]}>
            <View style={styles.resultHeader}>
              <PanelTitle number="2" title="자동 분석" text="컬럼 설정 없이 Gemini가 핵심 지표와 보고서를 만듭니다." />
              <Pressable
                disabled={!canAnalyze || busy}
                style={[styles.runButton, (!canAnalyze || busy) && styles.disabledButton]}
                onPress={runAnalysis}
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.runButtonText}>분석 실행</Text>}
              </Pressable>
            </View>

            {analysis ? (
              <>
                <View style={styles.metricGrid}>
                  {analysis.metrics.map((metric) => (
                    <View key={metric.label} style={styles.metricCard}>
                      <Text style={styles.metricLabel}>{metric.label}</Text>
                      <Text style={styles.metricValue}>{metric.value}</Text>
                      <Text style={styles.metricDetail}>{metric.detail}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.chartTabs}>
                  {(["bar", "line", "table"] as ChartType[]).map((type) => (
                    <Pressable
                      key={type}
                      style={[styles.chartTab, chartType === type && styles.chartTabActive]}
                      onPress={() => setChartType(type)}
                    >
                      <Text style={[styles.chartTabText, chartType === type && styles.chartTabTextActive]}>
                        {type === "bar" ? "막대" : type === "line" ? "추세" : "표"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.chartBox}>
                  {chartType === "table" ? (
                    chartPoints.map((point) => (
                      <View key={point.label} style={styles.tableRow}>
                        <Text style={styles.tableLabel}>{point.label}</Text>
                        <Text style={styles.tableValue}>{point.value.toLocaleString("ko-KR")}</Text>
                      </View>
                    ))
                  ) : (
                    chartPoints.map((point, index) => (
                      <View key={point.label} style={styles.barRow}>
                        <Text style={styles.barLabel}>{point.label}</Text>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                width: `${Math.max((point.value / maxValue) * 100, 4)}%`,
                                backgroundColor: chartType === "line" ? "#0f766e" : "#2563eb",
                                opacity: chartType === "line" ? 0.55 + index / Math.max(chartPoints.length * 2, 1) : 1
                              }
                            ]}
                          />
                        </View>
                        <Text style={styles.barValue}>{point.value.toLocaleString("ko-KR")}</Text>
                      </View>
                    ))
                  )}
                </View>

                <View style={styles.reportBox}>
                  <Text style={styles.reportTitle}>보고서 초안</Text>
                  <Text style={styles.reportText}>{analysis.reportDraft}</Text>
                </View>
              </>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>분석 결과 대기 중</Text>
                <Text style={styles.emptyText}>파일을 올리고 API 키를 입력하면 Gemini가 바로 분석합니다.</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PanelTitle({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <View style={styles.panelTitle}>
      <Text style={styles.badge}>{number}</Text>
      <View style={styles.panelTitleText}>
        <Text style={styles.panelHeading}>{title}</Text>
        <Text style={styles.panelSubheading}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f7fb"
  },
  screen: {
    gap: 20,
    padding: 24
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 18,
    justifyContent: "space-between"
  },
  eyebrow: {
    color: "#2563eb",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2
  },
  title: {
    color: "#1f2937",
    fontSize: 30,
    fontWeight: "900"
  },
  status: {
    color: "#667085",
    maxWidth: 520,
    textAlign: "right"
  },
  grid: {
    flexDirection: "row",
    gap: 18
  },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#d8dee8",
    borderRadius: 8,
    borderWidth: 1,
    flex: 0.85,
    gap: 12,
    padding: 18
  },
  resultPanel: {
    flex: 1.25
  },
  panelTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 50
  },
  panelTitleText: {
    flex: 1
  },
  badge: {
    backgroundColor: "#2563eb",
    borderRadius: 6,
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    height: 38,
    lineHeight: 38,
    textAlign: "center",
    width: 38
  },
  panelHeading: {
    color: "#1f2937",
    fontSize: 19,
    fontWeight: "900"
  },
  panelSubheading: {
    color: "#667085",
    fontSize: 13,
    lineHeight: 18
  },
  label: {
    color: "#667085",
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    backgroundColor: "#f0f3f8",
    borderColor: "#d8dee8",
    borderRadius: 6,
    borderWidth: 1,
    color: "#1f2937",
    minHeight: 42,
    paddingHorizontal: 12
  },
  textArea: {
    minHeight: 220,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 6,
    minHeight: 44,
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "900"
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#d8dee8",
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#1f2937",
    fontWeight: "800"
  },
  orText: {
    color: "#667085",
    fontSize: 13,
    textAlign: "center"
  },
  resultHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  runButton: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 6,
    height: 42,
    justifyContent: "center",
    minWidth: 108,
    paddingHorizontal: 14
  },
  runButtonText: {
    color: "#ffffff",
    fontWeight: "900"
  },
  disabledButton: {
    opacity: 0.42
  },
  metricGrid: {
    flexDirection: "row",
    gap: 10
  },
  metricCard: {
    backgroundColor: "#f0f3f8",
    borderColor: "#d8dee8",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 108,
    padding: 12
  },
  metricLabel: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800"
  },
  metricValue: {
    color: "#1f2937",
    fontSize: 22,
    fontWeight: "900",
    marginVertical: 6
  },
  metricDetail: {
    color: "#667085",
    fontSize: 12
  },
  chartTabs: {
    flexDirection: "row",
    gap: 8
  },
  chartTab: {
    borderColor: "#d8dee8",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  chartTabActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb"
  },
  chartTabText: {
    color: "#1f2937",
    fontWeight: "800"
  },
  chartTabTextActive: {
    color: "#ffffff"
  },
  chartBox: {
    backgroundColor: "#ffffff",
    borderColor: "#d8dee8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    minHeight: 260,
    padding: 14
  },
  barRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  barLabel: {
    color: "#667085",
    width: 72
  },
  barTrack: {
    backgroundColor: "#e8edf4",
    borderRadius: 999,
    flex: 1,
    height: 14,
    overflow: "hidden"
  },
  barFill: {
    borderRadius: 999,
    height: 14
  },
  barValue: {
    color: "#1f2937",
    fontWeight: "800",
    textAlign: "right",
    width: 86
  },
  tableRow: {
    borderBottomColor: "#e8edf4",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10
  },
  tableLabel: {
    color: "#667085"
  },
  tableValue: {
    color: "#1f2937",
    fontWeight: "900"
  },
  reportBox: {
    backgroundColor: "#f0f3f8",
    borderRadius: 8,
    padding: 14
  },
  reportTitle: {
    color: "#1f2937",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8
  },
  reportText: {
    color: "#667085",
    lineHeight: 22
  },
  emptyState: {
    alignItems: "center",
    borderColor: "#d8dee8",
    borderRadius: 8,
    borderStyle: "dashed",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 440,
    padding: 24
  },
  emptyTitle: {
    color: "#1f2937",
    fontSize: 18,
    fontWeight: "900"
  },
  emptyText: {
    color: "#667085",
    marginTop: 6,
    textAlign: "center"
  }
});
