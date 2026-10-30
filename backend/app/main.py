from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from app.config import get_settings

from app.routers.auth import router as auth_router
from app.routers.chat import router as chat_router
from app.routers.chat_runs import router as chat_runs_router
from app.routers.resumes import router as resumes_router
from app.routers.stt import router as stt_router
from app.routers.tts import router as tts_router

app = FastAPI(title="AI Career API", version="0.1.0")


@app.middleware('http')
async def auth_no_store(request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        if not request.url.path.startswith('/api/auth/'):
            raise
        logging.getLogger(__name__).exception('Authentication request failed')
        response = JSONResponse(status_code=500, content={'detail': '认证服务暂不可用，请稍后重试'})
    if request.url.path.startswith('/api/auth/'):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Pragma'] = 'no-cache'
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().auth_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(chat_runs_router)
app.include_router(resumes_router)
app.include_router(stt_router)
app.include_router(tts_router)


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}
