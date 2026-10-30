"""Preview expired sessions by default. Use --execute after checking the target."""
import argparse
import asyncio
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import delete, func, select
from app.database import async_session_factory, engine
from app.models.auth_session import AuthSession


async def cleanup(execute=False):
    print('Database:', engine.url.render_as_string(hide_password=True))
    now = int(time.time())
    async with async_session_factory() as db:
        count = await db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.expires_at <= now))
        print('Expired sessions:', count)
        if execute:
            result = await db.execute(delete(AuthSession).where(AuthSession.expires_at <= now))
            await db.commit()
            print('Deleted:', result.rowcount)
    await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    asyncio.run(cleanup(parser.parse_args().execute))
