import sqlite3

from alembic import command
from alembic.config import Config


def test_auth_migration_upgrade_and_downgrade(tmp_path, monkeypatch):
    """Exercise actual migrations against a new disposable database only."""
    path = tmp_path / 'migration-test.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite+aiosqlite:///{path.as_posix()}')
    config = Config('alembic.ini')
    command.upgrade(config, 'head')
    with sqlite3.connect(path) as connection:
        assert connection.execute('SELECT version_num FROM alembic_version').fetchone()[0] == 'a013_chat_runs'
        run_columns = {row[1] for row in connection.execute('PRAGMA table_info(chat_runs)')}
        assert {'request_hash', 'lease_until', 'attempt', 'input_json'} <= run_columns
        columns = {row[1] for row in connection.execute('PRAGMA table_info(auth_sessions)')}
        assert {'id', 'user_id', 'refresh_hash', 'expires_at'} <= columns
    command.downgrade(config, '4b3e3602294c')
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT name FROM sqlite_master WHERE name='auth_sessions'").fetchone() is None
