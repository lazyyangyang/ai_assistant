from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.auth import router as auth_router
from app.routers.chat import router as chat_router
from app.routers.resumes import router as resumes_router
from app.routers.stt import router as stt_router
from app.routers.tts import router as tts_router

app = FastAPI(title="AI Career API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(resumes_router)
app.include_router(stt_router)
app.include_router(tts_router)


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}
