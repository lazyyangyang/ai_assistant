"""Independent bounded JD worker: python -m app.worker (from backend)."""
import asyncio
import json
import logging
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text, update
from sqlalchemy.exc import OperationalError
from app.agents import stream_agent_response, extract_jd_structured
from app.config import get_settings
from app.database import async_session_factory
from app.models.chat import ChatMessage, ChatSession
from app.models.chat_run import ChatRun
from app.services.run_events import RunEvents
from app.services.sqlite_errors import is_sqlite_busy

log = logging.getLogger(__name__)


class LostLease(Exception):
    pass


class CancelledRun(Exception):
    pass


async def claim(worker_id):
    settings = get_settings()
    now = int(time.time())
    async with async_session_factory() as db:
        await db.execute(text('BEGIN IMMEDIATE'))
        await db.execute(update(ChatRun).where(ChatRun.status == 'running', ChatRun.lease_until < now)
                         .values(status='interrupted', error_code='worker_lost'))
        await db.execute(update(ChatRun).where(ChatRun.status == 'queued',
            ChatRun.created_at < datetime.now(timezone.utc) - timedelta(seconds=settings.run_queue_timeout))
            .values(status='failed', error_code='queue_timeout'))
        run = await db.scalar(select(ChatRun).where(ChatRun.status == 'queued').order_by(ChatRun.created_at).limit(1))
        if run:
            run.status = 'running'
            run.attempt += 1
            run.worker_id = worker_id
            run.lease_until = now + settings.run_lease_seconds
        await db.commit()
        return run


async def persist(run, status=None, error=None):
    for attempt in range(3):
        try:
            return await _persist_once(run, status, error)
        except OperationalError as exc:
            if not is_sqlite_busy(exc) or attempt == 2:
                raise
            await asyncio.sleep(0.25 * (attempt + 1))


async def _persist_once(run, status=None, error=None):
    """All writes for a run are serialized by its execution loop and fenced."""
    async with async_session_factory() as db:
        await db.execute(text('BEGIN IMMEDIATE'))
        current = await db.get(ChatRun, run.id)
        if (not current or current.status != 'running' or current.attempt != run.attempt
                or current.worker_id != run.worker_id or current.lease_until < time.time()):
            raise LostLease()
        if current.cancel_requested and status != 'cancelled':
            raise CancelledRun()
        current.result_text = run.result_text
        current.phase = run.phase
        current.structured_json = run.structured_json
        current.lease_until = int(time.time()) + get_settings().run_lease_seconds
        current.status = status or 'running'
        current.error_code = error
        message = await db.get(ChatMessage, current.assistant_message_id)
        message.content = run.result_text
        if status == 'succeeded' and run.structured_json:
            session = await db.get(ChatSession, current.session_id)
            session.jd_content = run.structured_json
        await db.commit()
        run.status, run.error_code = current.status, error
        run.cancel_requested = current.cancel_requested


async def execute(run, events):
    settings = get_settings()
    phase = 'analysis'
    pending_model_call = None
    response_iterator = None
    try:
        await events.publish(run, 'status', {'phase': phase})
        # 使用受理时冻结的输入，执行期间不重新拼接可能变化的会话历史。
        context = json.loads(run.input_json)
        request_data = context['request']
        history = context['history'] + [{'role': 'user', 'content': request_data['content']}]
        response_iterator = stream_agent_response('jd', history, jd_context=json.loads(context['jd_context']) if context['jd_context'] else None).__aiter__()
        last_checkpoint_at = last_event_at = time.monotonic()
        generation_started_at = last_checkpoint_at
        buffered_text = ''
        pending_model_call = asyncio.create_task(anext(response_iterator))
        while True:
            done, _ = await asyncio.wait({pending_model_call}, timeout=0.1)
            now = time.monotonic()
            if now - generation_started_at > settings.run_timeout:
                raise TimeoutError('generation timeout')
            stream_finished = False
            if done:
                try:
                    token = pending_model_call.result()
                    buffered_text += token
                    run.result_text += token
                    if len(run.result_text) > settings.run_text_limit:
                        raise ValueError('text limit')
                    pending_model_call = asyncio.create_task(anext(response_iterator))
                except StopAsyncIteration:
                    pending_model_call = None
                    stream_finished = True
            if now - last_checkpoint_at >= settings.run_snapshot_seconds:
                await persist(run)
                last_checkpoint_at = now
            if buffered_text and (now - last_event_at >= 0.1 or stream_finished):
                await events.publish(run, 'token', {'content': buffered_text})
                buffered_text = ''
                last_event_at = now
            if stream_finished:
                break
        # 追问只生成回复；只有新分析和修正才更新结构化 JD。
        if request_data['mode'] != 'followup':
            phase = run.phase = 'structured'
            await persist(run)
            await events.publish(run, 'status', {'phase': phase})
            pending_model_call = asyncio.create_task(extract_jd_structured(context.get('raw_jd', request_data['content'])))
            while not pending_model_call.done():
                await asyncio.wait({pending_model_call}, timeout=settings.run_snapshot_seconds)
                await persist(run)
                if time.monotonic() - generation_started_at > settings.run_timeout:
                    raise TimeoutError('extraction timeout')
            structured = pending_model_call.result()
            pending_model_call = None
            run.structured_json = json.dumps(structured, ensure_ascii=False)
        phase = run.phase = 'saving'
        await persist(run, 'succeeded')
        # Failure here must never rerun the model or rewrite durable success as failure.
        try:
            await events.publish(run, 'completed', {'status': 'succeeded'}, terminal=True)
        except Exception:
            log.warning('Completion event unavailable for run %s; query remains authoritative', run.id)
    except LostLease:
        return
    except (Exception, asyncio.CancelledError) as exc:
        state = 'cancelled' if isinstance(exc, CancelledRun) else 'failed'
        code = None if state == 'cancelled' else f'{phase}_failed'
        try:
            await persist(run, state, code)
        except CancelledRun:
            await persist(run, 'cancelled')
        except LostLease:
            return
        try:
            await events.publish(run, run.status, {'error_code': run.error_code}, terminal=True)
        except Exception:
            log.warning('Terminal event unavailable for run %s', run.id)
    finally:
        if pending_model_call:
            pending_model_call.cancel()
            await asyncio.gather(pending_model_call, return_exceptions=True)
        if response_iterator:
            await response_iterator.aclose()


async def main():
    settings = get_settings()
    if not settings.chat_runs_enabled:
        raise SystemExit('Set CHAT_RUNS_ENABLED=true after applying migrations and configuring Redis')
    events = RunEvents()
    worker_id = uuid.uuid4().hex
    active_tasks = set()
    cleanup_cursor = ''
    last_cleanup = 0
    claim_failures = 0
    try:
        await events.redis.ping()
        while True:
            if time.monotonic() - last_cleanup > 30:
                # Bounded durable-state reconciliation also handles a lost terminal event.
                try:
                    async with async_session_factory() as db:
                        terminal_ids = (await db.scalars(select(ChatRun.id).where(
                            ChatRun.status.notin_(['queued', 'running']), ChatRun.id > cleanup_cursor
                        ).order_by(ChatRun.id).limit(100))).all()
                    for run_id in terminal_ids:
                        for key in events.keys(run_id):
                            await events.redis.expire(key, settings.run_event_ttl, nx=True)
                    cleanup_cursor = terminal_ids[-1] if len(terminal_ids) == 100 else ''
                except Exception:
                    log.warning('Terminal Redis cleanup deferred')
                last_cleanup = time.monotonic()
            for task in list(active_tasks):
                if task.done():
                    active_tasks.remove(task)
                    try:
                        task.result()
                    except Exception:
                        log.exception('Run could not be finalized; lease expiry will mark interruption')
            if len(active_tasks) < settings.run_worker_concurrency:
                try:
                    run = await claim(worker_id)
                except OperationalError as exc:
                    if not is_sqlite_busy(exc):
                        raise
                    # claim's session has closed/rolled back before sleeping.
                    # Do not cancel active jobs or replay a model invocation.
                    claim_failures += 1
                    delay = min(5.0, 0.25 * 2 ** min(claim_failures - 1, 5))
                    log.warning('SQLite busy claiming work; failure=%s retry in %.2fs',
                                claim_failures, delay)
                    await asyncio.sleep(delay + random.uniform(0, 0.25))
                    continue
                if claim_failures:
                    log.info('SQLite claim recovered after %s failures', claim_failures)
                claim_failures = 0
                if run:
                    active_tasks.add(asyncio.create_task(execute(run, events)))
                    continue
            await asyncio.sleep(1)
    finally:
        for task in active_tasks:
            task.cancel()
        await asyncio.gather(*active_tasks, return_exceptions=True)
        await events.close()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
