from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .services import analyze_dataset, create_export, ingest_dataset, preview_chart

app = FastAPI(title="Data Insight Converter API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    dataset_id: str
    gemini_api_key: str | None = None


class ChartPreviewRequest(BaseModel):
    dataset_id: str
    chart_type: str


class ExportRequest(BaseModel):
    dataset_id: str
    format: str
    selected_chart_type: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/ingest")
async def ingest(text: str = Form(default=""), file: UploadFile | None = File(default=None)):
    content: str | bytes = text
    filename = None
    if file:
        filename = file.filename
        content = await file.read()
    try:
        return ingest_dataset(content, filename=filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest):
    try:
        return analyze_dataset(request.dataset_id, gemini_api_key=request.gemini_api_key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="dataset not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/chart/preview")
def chart_preview(request: ChartPreviewRequest):
    try:
        return preview_chart(request.dataset_id, request.chart_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="dataset not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/export")
def export(request: ExportRequest):
    try:
        payload, media_type, filename = create_export(
            request.dataset_id,
            request.format,
            request.selected_chart_type,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="dataset not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=payload,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
