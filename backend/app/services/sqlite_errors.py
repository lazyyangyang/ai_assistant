"""Identify retryable SQLite contention without hiding other database failures."""
import sqlite3


def is_sqlite_busy(exc):
    original = getattr(exc, 'orig', None)
    return (isinstance(original, sqlite3.OperationalError)
            and (getattr(original, 'sqlite_errorcode', 0) & 0xff)
            in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED))
