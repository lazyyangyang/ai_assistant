from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    chat_runs_enabled: bool = False
    chat_runs_per_user: int = Field(default=3, ge=1)
    chat_runs_capacity: int = Field(default=100, ge=1)
    redis_url: str = 'redis://127.0.0.1:6379/0'
    run_environment: str = 'development'
    run_worker_concurrency: int = Field(default=2, ge=1, le=16)
    run_lease_seconds: int = Field(default=60, ge=30)
    run_snapshot_seconds: float = Field(default=2, ge=1, le=10)
    run_timeout: int = Field(default=600, ge=10)
    run_queue_timeout: int = Field(default=300, ge=10)
    run_text_limit: int = Field(default=100000, ge=1000)
    run_event_limit: int = Field(default=2000, ge=100)
    run_event_ttl: int = Field(default=86400, ge=60)
    openai_api_key: str = Field(default="")
    openai_base_url: str = Field(default="https://api.openai.com/v1")
    openai_model: str = Field(default="gpt-4o-mini")

    # Optional: absolute path to `ffmpeg.exe` (Windows).
    # If empty, `stt` will fall back to `shutil.which("ffmpeg")`.
    ffmpeg_bin: str = Field(default="")

    # ── STT (speech-to-text) ──────────────────────────────
    # Default uses OpenAI Whisper-compatible `/audio/transcriptions`.
    stt_model: str = Field(default="whisper-1")
    stt_transcribe_path: str = Field(default="/audio/transcriptions")
    # If set, takes precedence over `openai_base_url + stt_transcribe_path`.
    stt_transcribe_url: str = Field(default="")
    stt_timeout_seconds: float = Field(default=120)

    # ── TTS (text-to-speech) ──────────────────────────────
    # Default uses OpenAI-compatible `/audio/speech`.
    tts_model: str = Field(default="tts-1")
    tts_voice: str = Field(default="alloy")
    tts_speech_path: str = Field(default="/audio/speech")
    # If set, takes precedence over `openai_base_url + tts_speech_path`.
    tts_speech_url: str = Field(default="")
    tts_response_format: str = Field(default="mp3")
    tts_timeout_seconds: float = Field(default=120)

    jwt_secret: str = Field(default="change-me-in-production-use-a-long-random-string")
    jwt_algorithm: str = Field(default="HS256")
    jwt_expire_minutes: int = Field(default=15, ge=2)
    refresh_expire_days: int = Field(default=7, ge=1, le=30)
    refresh_cookie_secure: bool = Field(default=False)
    auth_max_active_sessions_per_user: int = Field(default=20, ge=1)
    auth_allowed_origins: list[str] = Field(default_factory=lambda: [
        "http://localhost:5173", "http://127.0.0.1:5173",
    ])

    database_url: str = Field(
        default="sqlite+aiosqlite:///./ai_career.db",
        description="开发默认 SQLite；生产切换为 postgresql+asyncpg://user:pass@host/dbname",
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


def get_settings() -> Settings:
    return Settings()
