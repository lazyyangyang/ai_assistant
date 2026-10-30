"""Add durable JD run records."""
from alembic import op
import sqlalchemy as sa

revision = 'a013_chat_runs'
down_revision = '9d10b7a1c201'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('chat_runs',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('session_id', sa.String(), sa.ForeignKey('chat_sessions.id'), nullable=False),
        sa.Column('client_request_id', sa.String(128), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('input_json', sa.Text(), nullable=False),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('phase', sa.String(24), nullable=False),
        sa.Column('user_message_id', sa.String(), sa.ForeignKey('chat_messages.id'), nullable=False),
        sa.Column('assistant_message_id', sa.String(), sa.ForeignKey('chat_messages.id'), nullable=False),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('worker_id', sa.String(128)),
        sa.Column('lease_until', sa.Integer()),
        sa.Column('error_code', sa.String(64)),
        sa.Column('cancel_requested', sa.Boolean(), nullable=False),
        sa.Column('result_text', sa.Text(), nullable=False),
        sa.Column('structured_json', sa.Text()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('user_id', 'client_request_id'),
    )
    for column in ('user_id', 'session_id', 'status'):
        op.create_index(f'ix_chat_runs_{column}', 'chat_runs', [column])


def downgrade():
    op.drop_table('chat_runs')
