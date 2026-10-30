"""Async database engine & session factory."""

from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
)

# WAL lets short API readers coexist with the independent worker's commits.
# Writers remain serialized by BEGIN IMMEDIATE; busy timeout is bounded.
if engine.dialect.name == 'sqlite':
    @event.listens_for(engine.sync_engine, 'connect')
    def configure_sqlite(connection, _):
        cursor = connection.cursor()
        try:
            cursor.execute('PRAGMA busy_timeout=5000')
            cursor.execute('PRAGMA journal_mode=WAL')
        finally:
            cursor.close()


async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a DB session."""
    async with async_session_factory() as session:
        yield session
