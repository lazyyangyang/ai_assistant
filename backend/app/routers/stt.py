"""Speech-to-text (STT) endpoints."""

from typing import Any

import json

import asyncio
import io
import math
import shutil
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.config import get_settings
from app.deps import get_current_user
from app.models.user import User
from app.schemas import TranscribeResponse

router = APIRouter(prefix="/api/stt", tags=["stt"])


def _looks_like_wav(*, filename: str, content_type: str | None) -> bool:
    filename_l = (filename or "").lower()
    if filename_l.endswith(".wav"):
        return True
    if content_type and content_type.lower().startswith("audio/wav"):
        return True
    return False


def _guess_input_suffix(*, filename: str, content_type: str | None) -> str:
    filename_l = (filename or "").lower()
    ct = (content_type or "").lower()

    # 优先信任 content_type（避免“文件名扩展名与真实容器不一致”导致 ffmpeg 探测失败）
    if ct.startswith("audio/wav"):
        return ".wav"
    if "webm" in ct:
        return ".webm"
    if "ogg" in ct:
        return ".ogg"

    # 回退到文件名判断
    if filename_l.endswith(".webm"):
        return ".webm"
    if filename_l.endswith(".ogg") or filename_l.endswith(".opus"):
        return ".ogg"
    if filename_l.endswith(".wav"):
        return ".wav"
    return ".audio"


async def _transcode_to_wav_ffmpeg(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str | None,
) -> tuple[bytes, str, str]:
    """
    Transcode uploaded audio into 16kHz mono PCM WAV using ffmpeg.

    Some STT providers reject webm/ogg(opus) containers with "unsupported file format".
    """
    # 允许通过环境变量显式指定 ffmpeg 路径，避免 PATH 配置不一致。
    settings = get_settings()
    import os

    ffmpeg_bin = settings.ffmpeg_bin.strip().strip('"').strip("'") or shutil.which("ffmpeg")
    # 兜底：有些情况下 .env 的反斜杠转义会导致只读取到目录（...\\ffmpeg\\bin）
    # 这时把它补成 ffmpeg.exe，避免 PermissionError/Not a binary。
    if ffmpeg_bin and not ffmpeg_bin.lower().endswith(".exe"):
        # 如果是目录，就补 ffmpeg.exe
        if os.path.isdir(ffmpeg_bin):
            candidate = os.path.join(ffmpeg_bin, "ffmpeg.exe")
            if os.path.exists(candidate):
                ffmpeg_bin = candidate
        # 如果只是以 \bin 或 /bin 结尾，也同样补
        elif ffmpeg_bin.lower().endswith(("\\bin", "/bin")):
            candidate = ffmpeg_bin + os.sep + "ffmpeg.exe"
            if os.path.exists(candidate):
                ffmpeg_bin = candidate
    if not ffmpeg_bin:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "未安装 ffmpeg，无法把 webm/ogg(opus) 转码为 wav。"
                "请安装 ffmpeg 并确保命令在 PATH 中可用，或在 backend/.env 配置 FFMPEG_BIN。"
            ),
        )

    suffix = _guess_input_suffix(filename=filename, content_type=content_type)
    input_fd, input_path = tempfile.mkstemp(suffix=suffix)
    out_path = input_path + ".wav"

    # 关闭 fd，后续直接用文件写入
    try:
        import os

        os.close(input_fd)
    except Exception:
        pass

    try:
        with Path(input_path).open("wb") as f:
            f.write(audio_bytes)

        cmd = [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            input_path,
            # 适度提高语音音量，避免把环境噪声也放大到干扰识别
            "-af",
            "volume=1.5",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            out_path,
        ]
        # Windows 某些环境下，子进程执行在特定线程上下文可能触发权限错误。
        # 这里改为同步调用 subprocess.run，避免 asyncio 子进程/线程上下文问题。
        import subprocess

        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        except PermissionError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    f"ffmpeg 执行被拒绝（PermissionError）。"
                    f"ffmpeg_bin={ffmpeg_bin}, cmd={cmd}. "
                    f"系统可能阻止该 exe 在当前进程中启动。"
                ),
            ) from e

        if result.returncode != 0:
            msg = (result.stderr or b"").decode("utf-8", errors="ignore")
            if not msg.strip():
                msg = (result.stdout or b"").decode("utf-8", errors="ignore")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"ffmpeg 转码失败：{msg[:2000]}",
            )

        out_bytes = Path(out_path).read_bytes()
        # 16kHz * 16bit mono: 1s ~= 32000 bytes（不含/含 header 不影响数量级）
        if len(out_bytes) < 5000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="转码后音频过短，可能录音没采集到有效语音（请按住说话更久一点后重试）",
            )
        return out_bytes, "audio.wav", "audio/wav"
    finally:
        try:
            Path(input_path).unlink(missing_ok=True)
        except Exception:
            pass
        try:
            Path(out_path).unlink(missing_ok=True)
        except Exception:
            pass


async def _transcribe_via_openai_compat(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str | None,
    language: str | None,
    debug_info: str | None = None,
) -> str:
    """Call an OpenAI-compatible `audio/transcriptions` endpoint."""
    settings = get_settings()

    if settings.stt_transcribe_url.strip():
        url = settings.stt_transcribe_url.strip()
    else:
        base = settings.openai_base_url.rstrip("/")
        path = settings.stt_transcribe_path.lstrip("/")
        url = f"{base}/{path}"

    data: dict[str, Any] = {
        "model": settings.stt_model,
        "stream": "false",
        # 限制模型行为：仅做语音转写，不做场景描述
        "prompt": "请仅输出语音内容的逐字转写文本，不要描述环境音、音乐或场景。",
    }
    data["language"] = (language or "zh").strip()

    headers = {"Authorization": f"Bearer {settings.openai_api_key}"}

    files = {
        "file": (filename, audio_bytes, content_type or "application/octet-stream"),
    }

    async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
        resp = await client.post(url, data=data, files=files, headers=headers)

    if resp.status_code >= 400:
        # Bubble up a concise error for clients; details are often not stable across providers.
        try:
            error_body = resp.text
        except Exception:
            error_body = ""
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"语音转写失败（HTTP {resp.status_code}）：{error_body[:300]} "
                f"(upload: filename={filename}, content_type={content_type})"
            ),
        )

    payload = resp.json()

    # OpenAI-compatible response typically returns `{ "text": "..." }`.
    # 但有些供应商会把结果放在其它字段里，所以做一点兼容解析。
    candidate_keys = [
        "text",
        "transcript",
        "transcription",
        "transcript_text",
        "result",
    ]
    text: str | None = None
    for k in candidate_keys:
        v = payload.get(k)
        if isinstance(v, str):
            text = v
            break

    if not isinstance(text, str) or not text.strip():
        # 给出 payload 片段，便于你判断第三方实际返回字段是什么
        snippet = json.dumps(payload, ensure_ascii=False)[:500]
        debug_suffix = f"，debug={debug_info}" if debug_info else ""
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"语音转写返回内容为空{debug_suffix}（payload 前 500 字符：{snippet}）",
        )

    return text


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    user: User = Depends(get_current_user),
):
    _ = user  # Explicitly document that auth is required.

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传音频文件为空",
        )

    # 防止录音数据过短/空文件导致 ffmpeg 解析失败（End of file / EBML invalid）
    if len(audio_bytes) < 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传音频数据过短或为空，建议再录一次（音频太小无法转写）",
        )

    filename_in = file.filename or "audio.webm"
    content_type_in = file.content_type

    audio_bytes_for_provider = audio_bytes
    filename_for_provider = filename_in
    content_type_for_provider = content_type_in

    # 保险起见：不是 wav 的都先转码，避免第三方报 "unsupported file format"
    if not _looks_like_wav(filename=filename_in, content_type=content_type_in):
        audio_bytes_for_provider, filename_for_provider, content_type_for_provider = (
            await _transcode_to_wav_ffmpeg(
                audio_bytes=audio_bytes,
                filename=filename_in,
                content_type=content_type_in,
            )
        )

    debug_info = None
    # 仅在 wav 时尝试抽取一些元信息，帮助定位为何识别结果为空。
    if _looks_like_wav(filename=filename_for_provider, content_type=content_type_for_provider):
        try:
            import wave
            from array import array

            with wave.open(io.BytesIO(audio_bytes_for_provider)) as wf:
                sr = wf.getframerate()
                ch = wf.getnchannels()
                sw = wf.getsampwidth()
                nframes = wf.getnframes()
                duration_s = nframes / float(sr) if sr else 0.0

                # 取前 3 秒估计能量（避免大文件）
                max_frames = min(nframes, int(sr * 3))
                raw = wf.readframes(max_frames)
                rms = None
                peak = None
                frac = None
                if sw == 2 and raw:
                    arr = array("h", raw)
                    if len(arr) > 0:
                        # 估算 RMS、峰值以及超过阈值比例（粗略判断“有无有效语音”）
                        s = 0.0
                        peak_val = 0
                        step = max(1, len(arr) // 20000)  # 控制计算量
                        # 阈值：占满幅度的 2% 以上的采样点比例
                        thresh = int(0.02 * 32767)
                        cnt = 0
                        over = 0
                        for i in range(0, len(arr), step):
                            x = int(arr[i])
                            peak_val = max(peak_val, abs(x))
                            s += (x * x)
                            if abs(x) >= thresh:
                                over += 1
                            cnt += 1
                        rms = math.sqrt(s / max(1, cnt))
                        peak = peak_val
                        frac = over / max(1, cnt)

                debug_info = (
                    f"wav(samplerate={sr},channels={ch},sampwidth={sw},duration={duration_s:.2f}s,"
                    f"rms~={None if rms is None else int(rms)},"
                    f"peak~={peak},"
                    f"frac_over_thresh~={None if frac is None else round(frac, 3)})"
                )
        except Exception:
            debug_info = "wav_meta_unavailable"

    text = await _transcribe_via_openai_compat(
        audio_bytes=audio_bytes_for_provider,
        filename=filename_for_provider,
        content_type=content_type_for_provider,
        language=language,
        debug_info=debug_info,
    )

    return TranscribeResponse(text=text)

