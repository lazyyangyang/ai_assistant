"""JD 任务受理、状态查询、取消与 SSE 观察接口。"""
import hashlib
import anyio
import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import OperationalError
from app.services.sqlite_errors import is_sqlite_busy

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user, bearer_scheme
from app.models.chat import AgentType, ChatMessage, ChatSession
from app.models.chat_run import ChatRun
from app.models.user import User

router = APIRouter(prefix="/api/chat/runs", tags=["chat runs"])
ACTIVE_RUN_STATUSES = ("queued", "running")


class JDRunRequest(BaseModel):
    client_request_id: str = Field(min_length=1, max_length=128)
    session_id: str | None = None
    content: str = Field(min_length=1, max_length=50000)
    mode: Literal["new", "followup", "update"] = "new"


def serialize_run(run):
    return {key: getattr(run, key) for key in (
        "id", "session_id", "status", "phase", "cancel_requested",
        "result_text", "structured_json", "error_code", "attempt",
        "assistant_message_id",
    )}


async def get_owned_run(db, run_id, user_id):
    run = await db.get(ChatRun, run_id)
    if run is None or run.user_id != user_id:
        raise HTTPException(404, "任务不存在")
    return run


async def begin_task_write(db):
    await db.rollback()
    if db.bind.dialect.name != "sqlite":
        raise HTTPException(503, "任务接口当前仅支持 SQLite")
    await db.execute(text("BEGIN IMMEDIATE"))


@router.post("")
async def submit(request_data: JDRunRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not get_settings().chat_runs_enabled:
        raise HTTPException(503, "任务执行服务尚未启用")
    if not request_data.content.strip():
        raise HTTPException(422, "输入不能为空")
    user_id = user.id
    payload = json.dumps(request_data.model_dump(exclude={"client_request_id"}), sort_keys=True, ensure_ascii=False)
    request_hash = hashlib.sha256(payload.encode()).hexdigest()
    try:
        await begin_task_write(db)
        # 同一请求 ID 重试只返回原任务，避免重复调用模型。
        existing = await db.scalar(select(ChatRun).where(ChatRun.user_id == user_id, ChatRun.client_request_id == request_data.client_request_id))
        if existing:
            if existing.request_hash != request_hash:
                raise HTTPException(409, "请求 ID 已用于不同内容")
            return serialize_run(existing)
        active = select(func.count()).select_from(ChatRun).where(ChatRun.status.in_(ACTIVE_RUN_STATUSES))
        if await db.scalar(active.where(ChatRun.user_id == user_id)) >= get_settings().chat_runs_per_user:
            raise HTTPException(429, "活动任务数量已达上限")
        if await db.scalar(active) >= get_settings().chat_runs_capacity:
            raise HTTPException(429, "任务队列已满")
        if request_data.session_id:
            session = await db.get(ChatSession, request_data.session_id)
            if not session or session.user_id != user_id or session.agent_type != AgentType.JD:
                raise HTTPException(404, "JD 会话不存在")
            if await db.scalar(active.where(ChatRun.session_id == session.id)):
                raise HTTPException(409, "当前会话已有活动任务")
        else:
            if request_data.mode != "new":
                raise HTTPException(422, "追问或更新需要指定会话")
            session = ChatSession(user_id=user_id, agent_type=AgentType.JD, title=request_data.content[:40])
            db.add(session)
            await db.flush()
        history = (await db.scalars(select(ChatMessage).where(ChatMessage.session_id == session.id).order_by(ChatMessage.created_at, ChatMessage.id))).all()
        previous_run = await db.scalar(select(ChatRun).where(ChatRun.session_id == session.id).order_by(ChatRun.created_at.desc(), ChatRun.id.desc()).limit(1))
        previous_context = json.loads(previous_run.input_json) if previous_run else {}
        raw_jd = request_data.content if request_data.mode == 'new' else previous_context.get('raw_jd', '')
        if request_data.mode == 'update':
            raw_jd += '\n补充或修正信息：\n' + request_data.content
        if len(raw_jd) > 50000:
            raise HTTPException(422, 'JD 累计内容超过上限，请新建分析')
        # 输入快照与消息、任务在同一事务提交，Worker 只领取已提交任务。
        context = {"request": json.loads(payload), "raw_jd": raw_jd, "jd_version": (previous_context.get('jd_version', 0) + (request_data.mode != 'followup')), "history": [{"role": m.role, "content": m.content} for m in history], "jd_context": session.jd_content}
        now = datetime.now(timezone.utc)
        user_message = ChatMessage(session_id=session.id, role="user", content=request_data.content, created_at=now)
        assistant_message = ChatMessage(session_id=session.id, role="assistant", content="", created_at=now + timedelta(microseconds=1))
        db.add_all([user_message, assistant_message])
        await db.flush()
        run = ChatRun(user_id=user_id, session_id=session.id, client_request_id=request_data.client_request_id,
                      request_hash=request_hash, input_json=json.dumps(context, ensure_ascii=False),
                      created_at=now,
                      user_message_id=user_message.id, assistant_message_id=assistant_message.id)
        db.add(run)
        await db.flush()
        result = serialize_run(run)
        await db.commit()
        return result
    except OperationalError as exc:
        if is_sqlite_busy(exc):
            raise HTTPException(503, '任务数据库忙，请稍后重试',
                                headers={'Retry-After': '1'}) from exc
        raise
    finally:
        await db.rollback()


@router.get("/{run_id}")
async def get_run(run_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return serialize_run(await get_owned_run(db, run_id, user.id))


@router.post("/{run_id}/cancel")
async def cancel(run_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user_id = user.id
    try:
        await begin_task_write(db)
        run = await get_owned_run(db, run_id, user_id)
        if run.status in ACTIVE_RUN_STATUSES:
            run.cancel_requested = True
            if run.status == "queued":
                run.status = "cancelled"
        result = serialize_run(run)
        await db.commit()
        return result
    except OperationalError as exc:
        if is_sqlite_busy(exc):
            raise HTTPException(503, '任务数据库忙，请稍后重试',
                                headers={'Retry-After': '1'}) from exc
        raise
    finally:
        await db.rollback()


@router.get('/{run_id}/events')
async def run_events(run_id: str, after: str = '0-0',
                     user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db),
                     credentials=Depends(bearer_scheme)):
    import re
    from sse_starlette.sse import EventSourceResponse
    from app.database import async_session_factory
    from app.services.run_events import RunEvents
    if not re.fullmatch(r'\d{1,20}-\d{1,20}', after):
        raise HTTPException(422, '无效事件游标')
    user_id = user.id
    await get_owned_run(db, run_id, user_id)
    await db.rollback()

    async def generate():
        events = None
        cursor = after
        try:
            events = RunEvents()
            # Snapshot and cursor are obtained from one atomic Redis hash read.
            initial = True
            while True:
                # SSE disconnect uses AnyIO level cancellation. Shield this short
                # DB unit, including acquire/rollback/close, so pool bookkeeping
                # cannot be interrupted. Never shield Redis waits or yields.
                auth_expired = False
                with anyio.CancelScope(shield=True):
                    async with async_session_factory() as check:
                        try:
                            await get_current_user(credentials, check)
                        except HTTPException:
                            auth_expired = True
                        if not auth_expired:
                            run = await get_owned_run(check, run_id, user_id)
                            persisted_snapshot = serialize_run(run)
                if auth_expired:
                    yield {'event': 'auth_expired', 'data': '{}'}
                    return
                if run.status not in ACTIVE_RUN_STATUSES:
                    yield {'event': 'snapshot', 'data': json.dumps(persisted_snapshot, ensure_ascii=False)}
                    yield {'event': 'completed' if run.status == 'succeeded' else run.status, 'data': json.dumps(persisted_snapshot, ensure_ascii=False)}
                    return
                snapshot = await events.snapshot(run_id)
                # Always replace on connection, also heals trimmed or lost streams.
                if snapshot:
                    value, cursor = snapshot
                    yield {'id': cursor, 'event': 'snapshot', 'data': json.dumps(value, ensure_ascii=False)}
                elif initial:
                    yield {'event': 'snapshot', 'data': json.dumps(persisted_snapshot, ensure_ascii=False)}
                initial = False
                batches = await events.read(run_id, cursor)
                for _, entries in batches:
                    for event_id, fields in entries:
                        cursor = event_id
                        yield {'id': event_id, 'event': fields['event'], 'data': fields['data']}
        except Exception:
            yield {'event': 'unavailable', 'data': '{}'}
        finally:
            if events:
                await events.close()

    return EventSourceResponse(generate(), headers={'Cache-Control': 'no-store'})


@router.get('')
async def session_runs(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    runs = await db.scalars(select(ChatRun).where(ChatRun.session_id == session_id, ChatRun.user_id == user.id)
                           .order_by(ChatRun.created_at.desc(), ChatRun.id.desc()).limit(1))
    return [serialize_run(run) for run in runs]
