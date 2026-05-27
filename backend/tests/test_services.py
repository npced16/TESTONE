import zipfile
from io import BytesIO

import pytest

from backend.app.services import (
    analyze_dataset,
    create_xlsx,
    create_export,
    ingest_dataset,
    preview_chart,
)


SAMPLE = """월,매출,고객수
1월,1000,10
2월,1500,12
3월,3000,18
"""


def test_ingest_and_analyze_extracts_three_metrics():
    dataset = ingest_dataset(SAMPLE)
    analysis = analyze_dataset(dataset["dataset_id"])

    assert len(analysis["metrics"]) == 3
    assert analysis["default_chart_type"] == "bar"
    assert analysis["chart_data_model"]["points"][0] == {"label": "1월", "value": 1000.0}
    assert "총합" in analysis["report_draft"]


def test_chart_preview_rejects_unknown_chart_type():
    dataset = ingest_dataset(SAMPLE)

    with pytest.raises(ValueError):
        preview_chart(dataset["dataset_id"], "radar")


def test_export_generates_xlsx_pdf_and_docx_payloads():
    dataset = ingest_dataset(SAMPLE)

    xlsx, xlsx_type, _ = create_export(dataset["dataset_id"], "xlsx", "bar")
    pdf, pdf_type, _ = create_export(dataset["dataset_id"], "pdf", "line")
    docx, docx_type, _ = create_export(dataset["dataset_id"], "docx", "table")

    assert xlsx_type.endswith("spreadsheetml.sheet")
    assert pdf_type == "application/pdf"
    assert docx_type.endswith("wordprocessingml.document")
    assert pdf.startswith(b"%PDF")
    assert zipfile.ZipFile(BytesIO(xlsx)).namelist()
    assert "word/document.xml" in zipfile.ZipFile(BytesIO(docx)).namelist()


def test_ingest_accepts_xlsx_bytes():
    source = ingest_dataset(SAMPLE)
    analysis = analyze_dataset(source["dataset_id"])
    xlsx = create_xlsx(analysis)

    uploaded = ingest_dataset(xlsx, filename="uploaded.xlsx")
    uploaded_analysis = analyze_dataset(uploaded["dataset_id"])

    assert uploaded["columns"] == ["Metric", "Value", "Detail"]
    assert uploaded_analysis["metrics"][0]["label"] == "Value 합계"


def test_text_ingest_auto_detects_header_after_title_rows():
    content = """월간 매출 리포트
작성일,2026-05-27

월,매출,고객수
1월,1000,10
2월,2500,14
"""

    dataset = ingest_dataset(content)
    analysis = analyze_dataset(dataset["dataset_id"])

    assert dataset["columns"] == ["월", "매출", "고객수"]
    assert analysis["metrics"][0]["label"] == "매출 합계"


def test_xlsx_ingest_auto_detects_header_after_title_rows():
    rows = [
        ["월간 매출 리포트", "", ""],
        ["작성일", "2026-05-27", ""],
        ["", "", ""],
        ["월", "매출", "고객수"],
        ["1월", 1000, 10],
        ["2월", 2500, 14],
    ]
    xlsx = build_test_xlsx(rows)

    dataset = ingest_dataset(xlsx, filename="messy.xlsx")
    analysis = analyze_dataset(dataset["dataset_id"])

    assert dataset["columns"] == ["월", "매출", "고객수"]
    assert analysis["metrics"][0]["label"] == "매출 합계"


def test_gemini_failure_falls_back_to_local_analysis(monkeypatch):
    dataset = ingest_dataset(SAMPLE)

    def fail_gemini(*_args, **_kwargs):
        raise ValueError("Gemini quota가 초과되어 로컬 분석으로 대체했습니다. 53s 후 다시 시도할 수 있습니다.")

    monkeypatch.setattr("backend.app.services.analyze_with_gemini", fail_gemini)
    analysis = analyze_dataset(dataset["dataset_id"], gemini_api_key="fake-key")

    assert analysis["analysis_source"] == "local_fallback"
    assert analysis["metrics"][0]["label"] == "매출 합계"
    assert "quota" in analysis["analysis_notice"]


def build_test_xlsx(rows):
    sheet_data = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row, start=1):
            cell_ref = f"{chr(64 + column_index)}{row_index}"
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{cell_ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{cell_ref}" t="inlineStr"><is><t>{value}</t></is></c>')
        sheet_data.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    workbook = BytesIO()
    with zipfile.ZipFile(workbook, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>""")
        archive.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""")
        archive.writestr("xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>""")
        archive.writestr("xl/_rels/workbook.xml.rels", """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>""")
        archive.writestr("xl/worksheets/sheet1.xml", f"""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(sheet_data)}</sheetData></worksheet>""")
    return workbook.getvalue()
