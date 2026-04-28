from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
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
    jwt_expire_minutes: int = Field(default=1440)

    database_url: str = Field(
        default="sqlite+aiosqlite:///./ai_career.db",
        description="开发默认 SQLite；生产切换为 postgresql+asyncpg://user:pass@host/dbname",
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


def get_settings() -> Settings:
    return Settings()
