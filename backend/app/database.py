"""Async database engine & session factory."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    # Routes commonly continue serializing or streaming ORM objects after commit;
    # keeping attributes loaded avoids implicit async refreshes outside greenlets.
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield one request-scoped session and always close it after the response."""
    async with async_session_factory() as session:
        yield session
