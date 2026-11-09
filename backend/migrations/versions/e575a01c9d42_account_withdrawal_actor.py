"""Keep an erased member as the author of shared records."""

from alembic import op
import sqlalchemy as sa

revision = "e575a01c9d42"
down_revision = "e576a01c9d42"
branch_labels = None
depends_on = None

ERASED_PROFILE_CHECK = (
    "withdrawn_at IS NULL OR (user_id IS NULL AND discord_user_id IS NULL "
    "AND notion_name IS NULL AND display_name = '탈퇴한 사용자' "
    "AND role = 'member' AND is_deleted IS TRUE AND deleted_at IS NOT NULL)"
)


def upgrade():
    if op.get_bind().dialect.name == "sqlite":
        # member 재작성은 FK ON에서 공동 기록을 CASCADE할 수 있다. 새 컬럼의 CHECK로 직접 추가한다.
        op.execute(
            "ALTER TABLE member ADD COLUMN withdrawn_at DATETIME "
            "CONSTRAINT ck_member_withdrawn_profile_erased CHECK (" + ERASED_PROFILE_CHECK + ")"
        )
        return
    op.add_column("member", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        op.f("ck_member_withdrawn_profile_erased"),
        "member",
        ERASED_PROFILE_CHECK,
    )


def downgrade():
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint(op.f("ck_member_withdrawn_profile_erased"), "member", type_="check")
    op.drop_column("member", "withdrawn_at")
