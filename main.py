import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from claude_service import generate_exercise, generate_counsel_exercise, docs_available
from database import delete_session, get_admin_sessions, get_bests, get_key_errors, get_sessions, init_db, save_key_errors, save_session

security = HTTPBasic(auto_error=False)


def check_auth(credentials: HTTPBasicCredentials = Depends(security)):
    password = os.getenv("APP_PASSWORD")
    if not password:
        return  # no password set — open access (local dev)
    if (
        credentials is None
        or not secrets.compare_digest(credentials.password.encode(), password.encode())
    ):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": 'Basic realm="lex"'},
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def root(auth=Depends(check_auth)):
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/api/docs-available")
async def get_docs_available(auth=Depends(check_auth)):
    return {"available": docs_available()}


@app.get("/api/exercise/counsel")
async def get_counsel_exercise(keys: str = "", auth=Depends(check_auth)):
    key_list = [k.strip() for k in keys.split(",") if k.strip()]
    if not key_list:
        raise HTTPException(status_code=400, detail="keys parameter required")
    return await generate_counsel_exercise(key_list)


@app.get("/api/exercise")
async def get_exercise(
    length: str = "long",
    subject: str = "pub",
    style: str = "passage",
    auth=Depends(check_auth),
):
    return await generate_exercise(length, subject, style)


class SessionResult(BaseModel):
    wpm: float
    accuracy: float
    topic: str
    mistakes: int = 0
    key_errors: dict = {}
    date: str = ""
    device_id: str = ""


@app.post("/api/progress")
async def post_progress(result: SessionResult, request: Request, auth=Depends(check_auth)):
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    old_bests = get_bests(result.device_id)
    save_session(result.wpm, result.accuracy, result.topic, result.mistakes, result.date, ip, result.device_id)
    if result.key_errors:
        save_key_errors(result.key_errors, result.device_id)
    return {
        "status": "ok",
        "new_best_wpm": result.wpm > (old_bests["best_wpm"] or 0),
        "new_best_mistakes": (
            old_bests["fewest_mistakes"] is None
            or result.mistakes < old_bests["fewest_mistakes"]
        ),
    }


@app.get("/api/progress")
async def get_progress(device_id: str = "", auth=Depends(check_auth)):
    return get_sessions(device_id)


@app.delete("/api/progress/{session_id}")
async def delete_progress(session_id: int, auth=Depends(check_auth)):
    delete_session(session_id)
    return {"status": "ok"}


@app.get("/api/heatmap")
async def get_heatmap(device_id: str = "", auth=Depends(check_auth)):
    return get_key_errors(device_id)


@app.get("/api/admin/sessions")
async def admin_sessions(key: str = ""):
    admin_key = os.getenv("ADMIN_KEY")
    if not admin_key or not secrets.compare_digest(key, admin_key):
        raise HTTPException(status_code=403, detail="Forbidden")
    return get_admin_sessions()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
