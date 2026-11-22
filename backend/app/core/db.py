from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings

settings.db_path.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False})


def init_db() -> None:
    from app import models  # noqa: F401  테이블 등록

    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """이미 있는 DB 파일에 새로 생긴 칸을 붙임 (create_all 은 있는 표를 바꾸지 않음)."""
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            have = {r[1] for r in conn.exec_driver_sql(f"PRAGMA table_info('{table.name}')")}
            for col in table.columns:
                if col.name in have:
                    continue
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                if default is None:
                    continue  # 기본값 없는 칸은 자동으로 붙이지 않음
                lit = f"'{default}'" if isinstance(default, str) else str(int(default) if isinstance(default, bool) else default)
                conn.exec_driver_sql(f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)} DEFAULT {lit}")


def get_session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s
