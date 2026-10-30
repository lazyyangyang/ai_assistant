"""SSE streaming chat endpoint."""

import json
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.agents import extract_interview_feedback, stream_agent_response
from app.database import get_db
from app.deps import get_current_user
from app.models.chat import AgentType, ChatMessage, ChatSession, SessionStatus
from app.models.resume import Resume
from app.models.user import User
from app.schemas import ChatMessageOut, ChatRequest, ChatSessionOut

router = APIRouter(prefix="/api/chat", tags=["chat"])


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
) -> AsyncGenerator[dict, None]:
    """Yield SSE events: token chunks then a [DONE] sentinel."""
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

    assistant_msg = ChatMessage(session_id=session.id, role="assistant", content="")
    db.add(assistant_msg)
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()

    should_end_interview = bool(
        req.agent_type == "interview"
        and user_content
        and (
            "结束面试" in user_content
            or "面试结束" in user_content
            or user_content.strip() == "结束"
        )
    )

    if should_end_interview:
        feedback = await extract_interview_feedback(
            history=history,
            resume_context=resume_context,
            jd_context=jd_context,
        )
        session.feedback = json.dumps(feedback, ensure_ascii=False)
        session.status = SessionStatus.COMPLETED

        assistant_text = _format_interview_feedback_summary(feedback)
        assistant_msg.content = assistant_text
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()

        yield {
            "event": "token",
            "data": json.dumps({"content": assistant_text}, ensure_ascii=False),
        }
        yield {"event": "done", "data": "[DONE]"}
        return

    partial = ""
    try:
        async for token in stream_agent_response(
            req.agent_type,
            history,
            resume_context=resume_context,
            jd_context=jd_context,
        ):
            partial += token
            assistant_msg.content = partial
            session.updated_at = datetime.now(timezone.utc)
            await db.commit()
            yield {
                "event": "token",
                "data": json.dumps({"content": token}, ensure_ascii=False),
            }
    except Exception:
        await db.rollback()
        raise

    yield {"event": "done", "data": "[DONE]"}


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.agent_type == 'jd':
        raise HTTPException(410, 'JD 已启用异步任务，请升级客户端并使用 /api/chat/runs')
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
        ),
        media_type="text/event-stream",
        headers={"X-Session-Id": session.id},
    )


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
