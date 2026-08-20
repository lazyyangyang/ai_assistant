"""SSE streaming chat endpoint."""

import asyncio
import json
import time
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.agents import extract_interview_feedback, extract_jd_structured, stream_agent_response
from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models.chat import AgentType, ChatMessage, ChatSession, MessageStatus, SessionStatus
from app.models.resume import Resume
from app.models.user import User
from app.schemas import ChatMessageOut, ChatRequest, ChatSessionOut

router = APIRouter(prefix="/api/chat", tags=["chat"])
# 进程内 Event 用于低延迟停止当前 worker 上的生成；数据库 MessageStatus 才是跨 worker 的最终事实。
# 因此停止接口会同时设置 Event 和更新数据库，不能只依赖这张内存表。
_active_streams: dict[str, asyncio.Event] = {}


def _should_persist_progress(
    content_length: int,
    last_persisted_length: int,
    elapsed_seconds: float,
    char_threshold: int,
    interval_seconds: float,
) -> bool:
    """Use whichever threshold is reached first to bound write rate and data loss."""
    return (
        content_length - last_persisted_length >= char_threshold
        or elapsed_seconds >= interval_seconds
    )


async def _persist_message_state(
    db: AsyncSession,
    message_id: str,
    session_id: str,
    content: str,
    target_status: MessageStatus | None = None,
    allowed_statuses: tuple[MessageStatus, ...] = (MessageStatus.GENERATING,),
    session_values: dict[str, object] | None = None,
) -> bool:
    """Conditionally persist stream progress without overwriting a concurrent stop.

    The status predicate is the concurrency guard: once another request changes a
    message to STOPPED, a late progress/completion write affects zero rows and
    therefore cannot revive that message as GENERATING or COMPLETED.
    """
    now = datetime.now(timezone.utc)
    message_values: dict[str, object] = {"content": content, "updated_at": now}
    if target_status is not None:
        message_values["status"] = target_status

    result = await db.execute(
        update(ChatMessage)
        .where(
            ChatMessage.id == message_id,
            ChatMessage.status.in_(allowed_statuses),
        )
        .values(**message_values)
    )
    changed = result.rowcount != 0
    if changed:
        # Session metadata belongs to the same logical transition. Only update it
        # when the guarded message update won, otherwise a losing request could
        # still mark an externally stopped interview as completed.
        await db.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(updated_at=now, **(session_values or {}))
        )
    await db.commit()
    return changed


def _format_interview_feedback_summary(feedback: dict[str, object]) -> str:
    overall_score = feedback.get("overallScore")
    overall_summary = feedback.get("overallSummary")
    aspects = feedback.get("aspects")
    improvements = feedback.get("improvements")

    lines: list[str] = []
    if isinstance(overall_score, (int, float)):
        lines.append(f"面试结束。总体评分：{int(overall_score)}/10")
    else:
        lines.append("面试结束。")

    if isinstance(overall_summary, str) and overall_summary.strip():
        lines.append(overall_summary.strip())

    # Keep assistant message concise; detailed visualization is on the end page.
    if isinstance(improvements, list) and improvements:
        lines.append("改进建议（优先级）：")
        for item in improvements[:6]:
            if isinstance(item, dict):
                title = str(item.get("title") or "").strip()
                detail = str(item.get("detail") or "").strip()
                priority = str(item.get("priority") or "").strip()
                prefix = f"[{priority}] " if priority else ""
                if title or detail:
                    lines.append(f"- {prefix}{title or detail}{f'：{detail}' if title and detail else ''}")
            elif isinstance(item, str):
                lines.append(f"- {item}")

    # Optionally include one-line aspect hints.
    if isinstance(aspects, list) and aspects:
        lines.append("分项评分概览：")
        for item in aspects[:5]:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
                score = item.get("score")
                if name and isinstance(score, (int, float)):
                    lines.append(f"- {name}：{int(score)}/10")

    return "\n".join(lines).strip()


def _pick_round_user_message(req: ChatRequest) -> str:
    for msg in reversed(req.messages):
        if msg.role == "user" and msg.content.strip():
            return msg.content.strip()
    return ""


async def _get_or_create_session(
    req: ChatRequest,
    user: User,
    db: AsyncSession,
) -> ChatSession:
    """Resolve only sessions owned by the caller, or create a new typed session."""
    if req.session_id:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == req.session_id,
                ChatSession.user_id == user.id,
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="会话不存在",
            )
        if req.resume_id:
            session.resume_id = req.resume_id
            session.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(session)
        return session

    title_seed = _pick_round_user_message(req)
    title = title_seed[:40] if title_seed else "新对话"
    session = ChatSession(
        user_id=user.id,
        agent_type=AgentType(req.agent_type),
        title=title,
        resume_id=req.resume_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def _event_generator(
    req: ChatRequest,
    db: AsyncSession,
    session: ChatSession,
    resume_context: str | None,
    jd_context: dict[str, object] | None,
    stop_event: asyncio.Event,
) -> AsyncGenerator[dict, None]:
    """Persist one chat round while yielding token, structured and done SSE events.

    Network delivery and database persistence intentionally run at different
    frequencies: every token is sent to the browser, while progress is flushed
    in batches and terminal states are always committed immediately.
    """
    user_content = _pick_round_user_message(req)
    if user_content:
        db.add(
            ChatMessage(
                session_id=session.id,
                role="user",
                content=user_content,
            )
        )
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()

    # Build LLM history strictly from persisted DB messages, so interview memory
    # survives refresh and does not rely on the frontend sending full `messages[]`.
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
    )
    history_messages = list(history_result.scalars().all())
    history = [{"role": m.role, "content": m.content} for m in history_messages]

    # Commit the GENERATING row before contacting the model so cancellation or a
    # provider failure always has a durable message to transition to a terminal state.
    assistant_msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content="",
        status=MessageStatus.GENERATING,
    )
    db.add(assistant_msg)
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    assistant_message_id = assistant_msg.id

    should_end_interview = bool(
        req.agent_type == "interview"
        and user_content
        and (
            "结束面试" in user_content
            or "面试结束" in user_content
            or user_content.strip() == "结束"
        )
    )

    partial = ""
    settings = get_settings()
    last_persisted_length = 0
    last_persisted_at = time.monotonic()
    try:
        if should_end_interview:
            feedback = await extract_interview_feedback(
                history=history,
                resume_context=resume_context,
                jd_context=jd_context,
            )
            assistant_text = _format_interview_feedback_summary(feedback)
            partial = assistant_text
            completed = await _persist_message_state(
                db,
                assistant_message_id,
                session.id,
                assistant_text,
                MessageStatus.COMPLETED,
                session_values={
                    "feedback": json.dumps(feedback, ensure_ascii=False),
                    "status": SessionStatus.COMPLETED,
                },
            )
            if not completed:
                return

            yield {
                "event": "token",
                "data": json.dumps({"content": assistant_text}, ensure_ascii=False),
            }
            yield {"event": "done", "data": "[DONE]"}
            return

        async for token in stream_agent_response(
            req.agent_type,
            history,
            resume_context=resume_context,
            jd_context=jd_context,
        ):
            if stop_event.is_set():
                # Same-process explicit stops are observed before another token is
                # emitted; the DB predicate below remains the cross-process fallback.
                await _persist_message_state(
                    db,
                    assistant_message_id,
                    session.id,
                    partial,
                    MessageStatus.STOPPED,
                    (MessageStatus.GENERATING, MessageStatus.STOPPED),
                )
                return

            partial += token
            now = time.monotonic()
            if _should_persist_progress(
                len(partial),
                last_persisted_length,
                now - last_persisted_at,
                settings.chat_stream_persist_chars,
                settings.chat_stream_persist_interval_seconds,
            ):
                # The conditional update doubles as a coarse stop poll for deployments
                # where the stop request lands on a different worker process.
                persisted = await _persist_message_state(
                    db,
                    assistant_message_id,
                    session.id,
                    partial,
                )
                if not persisted:
                    await _persist_message_state(
                        db,
                        assistant_message_id,
                        session.id,
                        partial,
                        MessageStatus.STOPPED,
                        (MessageStatus.STOPPED,),
                    )
                    return
                last_persisted_length = len(partial)
                last_persisted_at = now

            yield {
                "event": "token",
                "data": json.dumps({"content": token}, ensure_ascii=False),
            }

        # Structured JD extraction is part of the same logical completion. If it
        # fails, the assistant message is marked FAILED instead of reporting a
        # completed message with missing session metadata.
        session_values: dict[str, object] = {}
        structured: dict[str, object] | None = None
        if req.agent_type == "jd" and user_content:
            structured = await extract_jd_structured(user_content)
            session_values["jd_content"] = json.dumps(structured, ensure_ascii=False)

        completed = await _persist_message_state(
            db,
            assistant_message_id,
            session.id,
            partial,
            MessageStatus.COMPLETED,
            session_values=session_values,
        )
        if not completed:
            await _persist_message_state(
                db,
                assistant_message_id,
                session.id,
                partial,
                MessageStatus.STOPPED,
                (MessageStatus.STOPPED,),
            )
            return

        if structured is not None:
            yield {
                "event": "structured",
                "data": json.dumps(structured, ensure_ascii=False),
            }

        yield {"event": "done", "data": "[DONE]"}
    except (asyncio.CancelledError, GeneratorExit):
        # Client disconnect cancellation propagates into this task. Shield the
        # terminal write so cancellation does not interrupt its own cleanup commit.
        await asyncio.shield(
            _persist_message_state(
                db,
                assistant_message_id,
                session.id,
                partial,
                MessageStatus.STOPPED,
                (MessageStatus.GENERATING, MessageStatus.STOPPED),
            )
        )
        raise
    except Exception:
        await db.rollback()
        # Keep the partial text for diagnostics and retry UX instead of deleting
        # an answer simply because the provider failed near the end.
        await _persist_message_state(
            db,
            assistant_message_id,
            session.id,
            partial,
            MessageStatus.FAILED,
        )
        raise
    finally:
        if _active_streams.get(session.id) is stop_event:
            _active_streams.pop(session.id, None)


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    resume_context: str | None = None
    if req.resume_id:
        resume_result = await db.execute(
            select(Resume).where(
                Resume.id == req.resume_id,
                Resume.user_id == user.id,
            )
        )
        resume = resume_result.scalar_one_or_none()
        if resume is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="简历不存在",
            )
        resume_context = resume.content

    session = await _get_or_create_session(req, user, db)
    # Register before returning EventSourceResponse so an immediate stop request
    # can find the stream even before the model produces its first token.
    stop_event = asyncio.Event()
    _active_streams[session.id] = stop_event
    if resume_context is None and session.resume_id:
        resume_result = await db.execute(
            select(Resume).where(
                Resume.id == session.resume_id,
                Resume.user_id == user.id,
            )
        )
        resume = resume_result.scalar_one_or_none()
        if resume is not None:
            resume_context = resume.content

    return EventSourceResponse(
        _event_generator(
            req,
            db,
            session,
            resume_context,
            req.jd_context,
            stop_event,
        ),
        media_type="text/event-stream",
        headers={"X-Session-Id": session.id},
    )


@router.post("/sessions/{session_id}/stop", status_code=status.HTTP_204_NO_CONTENT)
async def stop_chat_generation(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Idempotently stop the caller's latest generating assistant message."""
    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    if session_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在",
        )

    stop_event = _active_streams.get(session_id)
    if stop_event is not None:
        stop_event.set()

    # Persist STOPPED even when the generating request is handled by another
    # process; that worker's next guarded flush will observe that it lost the race.
    message_result = await db.execute(
        select(ChatMessage)
        .where(
            ChatMessage.session_id == session_id,
            ChatMessage.role == "assistant",
            ChatMessage.status == MessageStatus.GENERATING,
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    message = message_result.scalar_one_or_none()
    if message is not None:
        message.status = MessageStatus.STOPPED
        session_update = datetime.now(timezone.utc)
        await db.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(updated_at=session_update)
        )
        await db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.updated_at.desc())
    )
    return list(result.scalars().all())


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
async def list_session_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    if session_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在",
        )

    message_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(message_result.scalars().all())
