"""Account withdrawal receipts and workspace-scoped artifact cleanup."""

from alembic import op
import sqlalchemy as sa

revision = "e575b02d8a31"
down_revision = "e575a01c9d42"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("workspace", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("workspace", sa.Column("identity_epoch", sa.Integer(), server_default="0", nullable=False))
    op.create_table(
        "withdrawal_receipt",
        sa.Column("withdrawal_id", sa.String(36), primary_key=True),
        sa.Column("proof_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("account_deleted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "privacy_cleanup",
        sa.Column("cleanup_id", sa.String(36), primary_key=True),
        sa.Column("withdrawal_id", sa.String(36), sa.ForeignKey("withdrawal_receipt.withdrawal_id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("identity_epoch", sa.Integer(), nullable=False),
        sa.Column("delete_workspace", sa.Boolean(), nullable=False),
        sa.Column("selectors", sa.Text(), nullable=False),
        sa.Column("backend_done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claim_token_hash", sa.String(64), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error_code", sa.String(64), nullable=True),
    )
    op.create_index("ix_privacy_cleanup_withdrawal_id", "privacy_cleanup", ["withdrawal_id"])
    op.create_index("ix_privacy_cleanup_workspace_id", "privacy_cleanup", ["workspace_id"])


def downgrade():
    op.drop_table("privacy_cleanup")
    op.drop_table("withdrawal_receipt")
    op.drop_column("workspace", "identity_epoch")
    op.drop_column("workspace", "deleted_at")
