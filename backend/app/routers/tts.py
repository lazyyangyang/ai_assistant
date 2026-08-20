"""Text-to-speech (TTS) endpoints."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import get_settings
from app.deps import get_current_user
from app.models.user import User
from app.schemas import TtsSynthesizeRequest

router = APIRouter(prefix="/api/tts", tags=["tts"])


async def _synthesize_via_openai_compat(
    *,
    text: str,
    voice: str,
    model: str,
    response_format: str,
) -> tuple[bytes, str]:
    """Call an OpenAI-compatible `audio/speech` endpoint."""
    settings = get_settings()

    if settings.tts_speech_url.strip():
        # A full URL supports vendors whose speech endpoint is not under the same
        # OpenAI-compatible base path as chat completions.
        url = settings.tts_speech_url.strip()
    else:
        base = settings.openai_base_url.rstrip("/")
        path = settings.tts_speech_path.lstrip("/")
        url = f"{base}/{path}"

    headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
    payload = {
        "model": model,
        "voice": voice,
        # OpenAI uses `input` field (not `text`).
        "input": text,
        "response_format": response_format,
    }

    async with httpx.AsyncClient(timeout=settings.tts_timeout_seconds) as client:
        resp = await client.post(url, json=payload, headers=headers)

    if resp.status_code >= 400:
        try:
            error_body = resp.text
        except Exception:
            error_body = ""
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            # Bound provider text so an upstream HTML error page is not reflected
            # wholesale into the application response.
            detail=f"语音合成失败（HTTP {resp.status_code}）：{error_body[:300]}",
        )

    content_type = resp.headers.get("content-type") or "audio/mpeg"
    return resp.content, content_type


@router.post("/synthesize")
async def synthesize(
    body: TtsSynthesizeRequest,
    user: User = Depends(get_current_user),
):
    """Proxy authenticated TTS requests without exposing the provider API key."""
    _ = user  # Explicitly document that auth is required.

    settings = get_settings()
    voice = body.voice.strip() if body.voice else settings.tts_voice
    model = body.model.strip() if body.model else settings.tts_model

    audio_bytes, content_type = await _synthesize_via_openai_compat(
        text=body.text,
        voice=voice,
        model=model,
        response_format=settings.tts_response_format,
    )

    return Response(content=audio_bytes, media_type=content_type)

