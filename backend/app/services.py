from __future__ import annotations

import csv
import io
import json
import statistics
import urllib.error
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from html import escape
from typing import Any
from xml.etree import ElementTree
from xml.sax.saxutils import escape as xml_escape


@dataclass
class Dataset:
    dataset_id: str
    columns: list[str]
    rows: list[dict[str, Any]]
    analysis: dict[str, Any] | None = None


STORE: dict[str, Dataset] = {}
CHART_TYPES = {"bar", "line", "pie", "table"}


def ingest_dataset(content: str | bytes, filename: str | None = None) -> dict[str, Any]:
    rows = parse_upload_content(content, filename)
    if not rows:
        raise ValueError("분석할 데이터가 없습니다.")
    dataset_id = str(uuid.uuid4())
    dataset = Dataset(dataset_id=dataset_id, columns=list(rows[0].keys()), rows=rows)
    STORE[dataset_id] = dataset
    return {
        "dataset_id": dataset_id,
        "columns": dataset.columns,
        "preview": dataset.rows[:5],
        "filename": filename,
    }


def parse_upload_content(content: str | bytes, filename: str | None = None) -> list[dict[str, Any]]:
    extension = (filename or "").lower().rsplit(".", maxsplit=1)[-1]
    if isinstance(content, bytes):
        if extension == "xlsx":
            return parse_xlsx(content)
        return parse_tabular_text(content.decode("utf-8-sig", errors="ignore"))
    return parse_tabular_text(content)


def parse_tabular_text(content: str) -> list[dict[str, Any]]:
    cleaned = content.strip("\ufeff \n\r\t")
    if not cleaned:
        return []
    delimiter = "\t" if "\t" in cleaned.splitlines()[0] else ","
    reader = csv.reader(io.StringIO(cleaned), delimiter=delimiter)
    table = [[coerce_value(value) for value in row] for row in reader]
    return rows_from_table(table)


def parse_xlsx(content: bytes) -> list[dict[str, Any]]:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as workbook:
            shared_strings = read_shared_strings(workbook)
            sheet_name = next((name for name in workbook.namelist() if name.startswith("xl/worksheets/sheet")), None)
            if not sheet_name:
                return []
            xml = workbook.read(sheet_name)
    except zipfile.BadZipFile as exc:
        raise ValueError("올바른 XLSX 파일이 아닙니다.") from exc

    namespace = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ElementTree.fromstring(xml)
    table: list[list[Any]] = []
    for row in root.findall(".//main:sheetData/main:row", namespace):
        values: list[Any] = []
        current_column = 0
        for cell in row.findall("main:c", namespace):
            cell_ref = cell.attrib.get("r", "")
            column_index = column_ref_to_index(cell_ref)
            while current_column < column_index:
                values.append("")
                current_column += 1
            values.append(read_cell_value(cell, shared_strings, namespace))
            current_column += 1
        if any(value != "" for value in values):
            table.append(values)

    return rows_from_table(table)


def rows_from_table(table: list[list[Any]]) -> list[dict[str, Any]]:
    normalized = [trim_empty_edges(row) for row in table if any(value != "" for value in row)]
    if len(normalized) < 2:
        return []
    header_index = detect_header_row(normalized)
    headers = [
        str(value).strip() or f"Column {index + 1}"
        for index, value in enumerate(normalized[header_index])
    ]
    rows: list[dict[str, Any]] = []
    for values in normalized[header_index + 1:]:
        row = {
            headers[index]: coerce_value(values[index] if index < len(values) else "")
            for index in range(len(headers))
        }
        if any(value != "" for value in row.values()):
            rows.append(row)
    return rows


def detect_header_row(table: list[list[Any]]) -> int:
    best_index = 0
    best_score = -1
    for index, row in enumerate(table[:-1]):
        next_rows = table[index + 1:index + 6]
        text_count = sum(1 for value in row if isinstance(value, str) and value.strip())
        unique_count = len({str(value).strip() for value in row if str(value).strip()})
        width = len([value for value in row if value != ""])
        numeric_below = sum(1 for next_row in next_rows for value in next_row if is_number(value))
        repeated_width_below = sum(1 for next_row in next_rows if len(next_row) >= max(width, 2))
        score = text_count * 3 + unique_count + numeric_below * 2 + repeated_width_below - index
        if width >= 2 and text_count >= 1 and score > best_score:
            best_score = score
            best_index = index
    return best_index


def trim_empty_edges(row: list[Any]) -> list[Any]:
    end = len(row)
    while end > 0 and row[end - 1] == "":
        end -= 1
    return row[:end]


def read_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    namespace = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for item in root.findall("main:si", namespace):
        values.append("".join(node.text or "" for node in item.findall(".//main:t", namespace)))
    return values


def read_cell_value(cell: ElementTree.Element, shared_strings: list[str], namespace: dict[str, str]) -> Any:
    value_node = cell.find("main:v", namespace)
    inline_node = cell.find("main:is/main:t", namespace)
    if inline_node is not None:
        return inline_node.text or ""
    if value_node is None or value_node.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        index = int(value_node.text)
        return shared_strings[index] if index < len(shared_strings) else ""
    return coerce_value(value_node.text)


def column_ref_to_index(cell_ref: str) -> int:
    letters = "".join(character for character in cell_ref if character.isalpha())
    index = 0
    for character in letters:
        index = index * 26 + (ord(character.upper()) - ord("A") + 1)
    return max(index - 1, 0)


def coerce_value(value: Any) -> Any:
    if value is None:
        return ""
    text = str(value).strip().replace(",", "")
    if text == "":
        return ""
    try:
        number = float(text)
    except ValueError:
        return str(value).strip()
    return int(number) if number.is_integer() else number


def analyze_dataset(dataset_id: str, gemini_api_key: str | None = None) -> dict[str, Any]:
    dataset = STORE[dataset_id]
    if gemini_api_key:
        try:
            dataset.analysis = analyze_with_gemini(dataset, gemini_api_key)
        except ValueError as exc:
            dataset.analysis = {
                **analyze_with_rules(dataset),
                "analysis_notice": str(exc),
                "analysis_source": "local_fallback",
            }
        return dataset.analysis
    if dataset.analysis:
        return dataset.analysis
    dataset.analysis = {
        **analyze_with_rules(dataset),
        "analysis_source": "local",
    }
    return dataset.analysis


def analyze_with_rules(dataset: Dataset) -> dict[str, Any]:
    numeric_columns = get_numeric_columns(dataset)
    if not numeric_columns:
        raise ValueError("숫자 컬럼이 필요합니다.")

    primary_measure = numeric_columns[0]
    dimension = first_dimension_column(dataset, numeric_columns)
    values = [float(row[primary_measure]) for row in dataset.rows if is_number(row.get(primary_measure))]
    total = sum(values)
    average = statistics.mean(values) if values else 0
    peak_row = max(dataset.rows, key=lambda row: float(row.get(primary_measure, 0)) if is_number(row.get(primary_measure)) else 0)
    peak_label = str(peak_row.get(dimension, "최고값"))
    trend = values[-1] - values[0] if len(values) > 1 else 0

    chart_points = [
        {"label": str(row.get(dimension, index + 1)), "value": float(row.get(primary_measure, 0))}
        for index, row in enumerate(dataset.rows)
        if is_number(row.get(primary_measure))
    ][:12]

    metrics = [
        {"label": f"{primary_measure} 합계", "value": format_number(total), "detail": "전체 행 기준 합산"},
        {"label": f"{primary_measure} 평균", "value": format_number(average), "detail": "숫자 데이터 평균"},
        {"label": "최고 구간", "value": peak_label, "detail": f"{format_number(float(peak_row[primary_measure]))} 기록"},
    ]
    insights = [
        f"{primary_measure}의 총합은 {format_number(total)}이며 평균은 {format_number(average)}입니다.",
        f"가장 높은 구간은 {peak_label}입니다.",
        f"첫 구간 대비 마지막 구간 변화량은 {format_number(trend)}입니다.",
    ]
    report = " ".join(insights)
    return {
        "dataset_id": dataset.dataset_id,
        "metrics": metrics,
        "insights": insights,
        "default_chart_type": "bar",
        "chart_data_model": {"title": f"{dimension}별 {primary_measure}", "points": chart_points},
        "report_draft": report,
    }


def analyze_with_gemini(dataset: Dataset, api_key: str) -> dict[str, Any]:
    base = analyze_with_rules(dataset)
    prompt = build_gemini_prompt(dataset, base)
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt,
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            gemini_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = parse_gemini_error(exc.read().decode("utf-8", errors="ignore"))
        raise ValueError(detail or f"Gemini API 요청 실패: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"Gemini API 연결 실패: {exc.reason}") from exc

    text = extract_gemini_text(gemini_payload)
    try:
        generated = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Gemini 응답을 JSON으로 해석하지 못했습니다.") from exc

    metrics = generated.get("metrics")
    insights = generated.get("insights")
    report = generated.get("report_draft")
    if not isinstance(metrics, list) or len(metrics) != 3 or not isinstance(insights, list) or not isinstance(report, str):
        raise ValueError("Gemini 응답 형식이 올바르지 않습니다.")

    return {
        **base,
        "metrics": [
            {
                "label": str(item.get("label", ""))[:40],
                "value": str(item.get("value", ""))[:40],
                "detail": str(item.get("detail", ""))[:80],
            }
            for item in metrics[:3]
        ],
        "insights": [str(item) for item in insights[:5]],
        "report_draft": report,
    }


def build_gemini_prompt(dataset: Dataset, base: dict[str, Any]) -> str:
    rows = dataset.rows[:30]
    return f"""
너는 한국어 데이터 분석가다. 아래 표 데이터를 분석해서 반드시 JSON만 반환해라.

반환 형식:
{{
  "metrics": [
    {{"label": "핵심 지표명", "value": "값", "detail": "짧은 설명"}},
    {{"label": "핵심 지표명", "value": "값", "detail": "짧은 설명"}},
    {{"label": "핵심 지표명", "value": "값", "detail": "짧은 설명"}}
  ],
  "insights": ["인사이트 1", "인사이트 2", "인사이트 3"],
  "report_draft": "결론과 시사점이 담긴 4문장 이내의 한국어 보고서 초안"
}}

규칙:
- metrics는 정확히 3개만 작성한다.
- value는 사용자가 바로 이해할 수 있게 단위와 쉼표를 포함해도 된다.
- 데이터에 없는 사실을 지어내지 않는다.
- 사용자에게 컬럼 선택이나 설정을 요구하지 말고, 주어진 표에서 가장 중요한 축과 수치를 직접 판단한다.
- chart_data_model은 만들지 않는다.

컬럼: {dataset.columns}
기본 계산 결과: {base["metrics"]}
표 데이터 샘플(JSON): {json.dumps(rows, ensure_ascii=False)}
""".strip()


def extract_gemini_text(payload: dict[str, Any]) -> str:
    try:
        parts = payload["candidates"][0]["content"]["parts"]
        return "".join(part.get("text", "") for part in parts).strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Gemini 응답에 텍스트가 없습니다.") from exc


def parse_gemini_error(raw_detail: str) -> str:
    try:
        payload = json.loads(raw_detail)
    except json.JSONDecodeError:
        return raw_detail[:240]
    error = payload.get("error", {})
    code = error.get("code")
    message = str(error.get("message", ""))
    if code == 429:
        retry = find_retry_delay(error.get("details", []))
        suffix = f" {retry} 후 다시 시도할 수 있습니다." if retry else ""
        return f"Gemini quota가 초과되어 로컬 분석으로 대체했습니다.{suffix}"
    if "API key" in message or code in {400, 401, 403}:
        return "Gemini API 키를 확인해주세요. 현재 결과는 로컬 분석으로 대체했습니다."
    return "Gemini API 요청이 실패해 로컬 분석으로 대체했습니다."


def find_retry_delay(details: Any) -> str:
    if not isinstance(details, list):
        return ""
    for item in details:
        if isinstance(item, dict) and item.get("@type") == "type.googleapis.com/google.rpc.RetryInfo":
            return str(item.get("retryDelay", ""))
    return ""


def preview_chart(dataset_id: str, chart_type: str) -> dict[str, Any]:
    if chart_type not in CHART_TYPES:
        raise ValueError("지원하지 않는 차트 타입입니다.")
    analysis = analyze_dataset(dataset_id)
    return {
        "chart_type": chart_type,
        "compatible": True,
        "chart_spec": analysis["chart_data_model"],
    }


def create_export(dataset_id: str, file_format: str, selected_chart_type: str) -> tuple[bytes, str, str]:
    if selected_chart_type not in CHART_TYPES:
        raise ValueError("지원하지 않는 차트 타입입니다.")
    analysis = analyze_dataset(dataset_id)
    normalized = file_format.lower()
    if normalized == "xlsx":
        return create_xlsx(analysis), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "insight-report.xlsx"
    if normalized == "docx":
        return create_docx(analysis, selected_chart_type), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "insight-report.docx"
    if normalized == "pdf":
        return create_pdf(analysis, selected_chart_type), "application/pdf", "insight-report.pdf"
    raise ValueError("지원하지 않는 파일 형식입니다.")


def get_numeric_columns(dataset: Dataset) -> list[str]:
    numeric_columns: list[str] = []
    for column in dataset.columns:
        values = [row.get(column) for row in dataset.rows]
        if any(is_number(value) for value in values):
            numeric_columns.append(column)
    return numeric_columns


def first_dimension_column(dataset: Dataset, numeric_columns: list[str]) -> str:
    return next((column for column in dataset.columns if column not in numeric_columns), dataset.columns[0])


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def format_number(value: float) -> str:
    if abs(value) >= 1000:
        return f"{value:,.0f}"
    return f"{value:.2f}".rstrip("0").rstrip(".")


def create_xlsx(analysis: dict[str, Any]) -> bytes:
    rows = [["Metric", "Value", "Detail"]]
    rows.extend([[item["label"], item["value"], item["detail"]] for item in analysis["metrics"]])
    sheet_data = "".join(
        f"<row r=\"{index}\">"
        + "".join(
            f"<c r=\"{chr(64 + column_index)}{index}\" t=\"inlineStr\"><is><t>{xml_escape(str(value))}</t></is></c>"
            for column_index, value in enumerate(row, start=1)
        )
        + "</row>"
        for index, row in enumerate(rows, start=1)
    )
    workbook = io.BytesIO()
    with zipfile.ZipFile(workbook, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", XLSX_CONTENT_TYPES)
        archive.writestr("_rels/.rels", XLSX_RELS)
        archive.writestr("xl/workbook.xml", XLSX_WORKBOOK)
        archive.writestr("xl/_rels/workbook.xml.rels", XLSX_WORKBOOK_RELS)
        archive.writestr("xl/worksheets/sheet1.xml", f"<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{sheet_data}</sheetData></worksheet>")
    return workbook.getvalue()


def create_docx(analysis: dict[str, Any], chart_type: str) -> bytes:
    paragraphs = [
        "데이터 인사이트 보고서",
        f"선택 차트: {chart_type}",
        analysis["report_draft"],
        *[f"- {item}" for item in analysis["insights"]],
    ]
    body = "".join(f"<w:p><w:r><w:t>{xml_escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
    document = f"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr/></w:body></w:document>"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", DOCX_CONTENT_TYPES)
        archive.writestr("_rels/.rels", DOCX_RELS)
        archive.writestr("word/document.xml", document)
    return output.getvalue()


def create_pdf(analysis: dict[str, Any], chart_type: str) -> bytes:
    text = escape(f"Data Insight Report\nChart: {chart_type}\n{analysis['report_draft']}")
    stream = f"BT /F1 14 Tf 50 760 Td ({text}) Tj ET"
    pdf = f"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF"
    return pdf.encode("utf-8")


XLSX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"""
XLSX_RELS = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"""
XLSX_WORKBOOK = """<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Insights" sheetId="1" r:id="rId1"/></sheets></workbook>"""
XLSX_WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
DOCX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"""
DOCX_RELS = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""
