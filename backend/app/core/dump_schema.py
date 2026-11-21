"""DB 스키마를 db/schema/schema.sql 로 내보내기. 실행: backend 폴더에서  .venv/Scripts/python -m app.core.dump_schema"""
from sqlalchemy.dialects import sqlite
from sqlalchemy.schema import CreateTable
from sqlmodel import SQLModel

from app import models  # noqa: F401
from app.core.config import UI_DIR


def main() -> None:
    out = ["-- WaveSpot DB 스키마 (SQLite) · backend/app/models.py 에서 자동 생성, 직접 고치지 말 것",
           "-- 다시 만들기: backend 폴더에서  .venv/Scripts/python -m app.core.dump_schema", ""]
    for t in SQLModel.metadata.sorted_tables:
        out.append(str(CreateTable(t).compile(dialect=sqlite.dialect())).strip() + ";\n")
    path = UI_DIR / "db" / "schema" / "schema.sql"
    path.write_text("\n".join(out), encoding="utf-8")
    print("saved", path)


if __name__ == "__main__":
    main()
