"""Retain meeting identity while deleting content and tracking file purge."""

from alembic import op
import sqlalchemy as sa

revision = "e576a01c9d42"
down_revision = "5ae76a6102a8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "meeting", sa.Column("deletion_ready", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.execute("UPDATE meeting SET deletion_ready = true WHERE source IN ('chat', 'manual_upload')")
    op.add_column(
        "meeting", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_meeting_deleted_at", "meeting", ["deleted_at"])
    op.add_column(
        "meeting", sa.Column("recording_root_id", sa.String(36), nullable=True)
    )
    op.create_foreign_key(
        "fk_meeting_recording_root",
        "meeting",
        "meeting",
        ["recording_root_id"],
        ["meeting_id"],
    )
    op.create_index("ix_meeting_recording_root_id", "meeting", ["recording_root_id"])
    op.add_column(
        "meeting", sa.Column("replaces_meeting_id", sa.String(36), nullable=True)
    )
    op.create_foreign_key(
        "fk_meeting_replaces",
        "meeting",
        "meeting",
        ["replaces_meeting_id"],
        ["meeting_id"],
    )
    op.create_unique_constraint(
        "uq_meeting_replaces_meeting_id", "meeting", ["replaces_meeting_id"]
    )
    op.create_table(
        "meeting_purge",
        sa.Column(
            "meeting_id",
            sa.String(36),
            sa.ForeignKey("meeting.meeting_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("backend_done_at", sa.DateTime(timezone=True)),
        sa.Column("ai_done_at", sa.DateTime(timezone=True)),
        sa.Column("claim_token_hash", sa.String(64)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error_code", sa.String(40)),
    )


def downgrade():
    op.drop_table("meeting_purge")
    op.drop_constraint("uq_meeting_replaces_meeting_id", "meeting", type_="unique")
    op.drop_constraint("fk_meeting_replaces", "meeting", type_="foreignkey")
    op.drop_column("meeting", "replaces_meeting_id")
    op.drop_index("ix_meeting_recording_root_id", table_name="meeting")
    op.drop_constraint("fk_meeting_recording_root", "meeting", type_="foreignkey")
    op.drop_column("meeting", "recording_root_id")
    op.drop_index("ix_meeting_deleted_at", table_name="meeting")
    op.drop_column("meeting", "deleted_at")
    op.drop_column("meeting", "deletion_ready")
