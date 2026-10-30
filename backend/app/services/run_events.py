"""Atomic, attempt-fenced Redis snapshots and replayable events."""
import asyncio
import json
from app.config import get_settings

PUBLISH = """
local previous = redis.call('HGET', KEYS[1], 'attempt')
if previous and tonumber(previous) > tonumber(ARGV[1]) then return false end
local id = redis.call('XADD', KEYS[2], 'MAXLEN', '=', ARGV[5], '*', 'event', ARGV[2], 'data', ARGV[3])
redis.call('HSET', KEYS[1], 'attempt', ARGV[1], 'data', ARGV[4], 'cursor', id)
if tonumber(ARGV[6]) > 0 then
 redis.call('EXPIRE', KEYS[1], ARGV[6]); redis.call('EXPIRE', KEYS[2], ARGV[6])
else
 redis.call('PERSIST', KEYS[1]); redis.call('PERSIST', KEYS[2])
end
return id
"""


class RunEvents:
    def __init__(self):
        from redis.asyncio import Redis
        self.settings = get_settings()
        self.redis = Redis.from_url(self.settings.redis_url, decode_responses=True,
                                    socket_connect_timeout=2, socket_timeout=5)

    def keys(self, run_id):
        prefix = f'ai-career:{self.settings.run_environment}:run:{{{run_id}}}'
        return prefix + ':snapshot', prefix + ':events'

    async def publish(self, run, event, data, terminal=False):
        snapshot = {key: getattr(run, key) for key in ('id', 'session_id', 'attempt', 'status', 'phase', 'result_text', 'structured_json', 'error_code', 'cancel_requested', 'assistant_message_id')}
        for retry in range(3):
            try:
                return await self.redis.eval(PUBLISH, 2, *self.keys(run.id), run.attempt, event,
                    json.dumps(data, ensure_ascii=False), json.dumps(snapshot, ensure_ascii=False),
                    self.settings.run_event_limit, self.settings.run_event_ttl if terminal else 0)
            except Exception:
                if retry == 2:
                    raise
                await asyncio.sleep(0.2 * (retry + 1))

    async def snapshot(self, run_id):
        value = await self.redis.hgetall(self.keys(run_id)[0])
        return (json.loads(value['data']), value['cursor']) if value else None

    async def read(self, run_id, cursor):
        return await self.redis.xread({self.keys(run_id)[1]: cursor}, count=100, block=1000)

    async def close(self):
        await self.redis.aclose()
