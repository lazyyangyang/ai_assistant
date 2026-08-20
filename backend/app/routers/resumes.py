"""Resume upload and version management endpoints."""

from io import BytesIO
from pathlib import Path

import pdfplumber
from docx import Document
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.resume import Resume
from app.models.user import User
from app.schemas import ResumeCreateRequest, ResumeOut, ResumeUpdateRequest

router = APIRouter(prefix="/api/resumes", tags=["resumes"])


def _extract_text(file: UploadFile, raw: bytes) -> str:
    """Extract text in memory; only normalized content, not the uploaded binary, is stored."""
    ext = Path(file.filename or "").suffix.lower()
    if ext == ".txt":
        return raw.decode("utf-8", errors="ignore").strip()

    if ext == ".pdf":
        text_chunks: list[str] = []
        with pdfplumber.open(BytesIO(raw)) as pdf:
            for page in pdf.pages:
                text_chunks.append(page.extract_text() or "")
        return "\n".join(text_chunks).strip()

    if ext == ".docx":
        doc = Document(BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs).strip()

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="仅支持 PDF / TXT / DOCX 文件",
    )


async def _ensure_single_active_resume(db: AsyncSession, user_id: str, resume_id: str) -> None:
    """Deactivate sibling versions inside the caller's current transaction."""
    await db.execute(
        update(Resume)
        .where(Resume.user_id == user_id, Resume.id != resume_id)
        .values(is_active=False)
    )


@router.post("/upload", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传文件为空",
        )

    content = _extract_text(file, raw)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未解析到可用文本内容",
        )

    result = await db.execute(
        select(func.max(Resume.version)).where(Resume.user_id == user.id)
    )
    latest_version = result.scalar_one_or_none() or 0
    next_version = latest_version + 1

    resume = Resume(
        user_id=user.id,
        version=next_version,
        title=(title or file.filename or f"简历 v{next_version}")[:128],
        content=content,
        is_active=True,
    )
    db.add(resume)
    # Flush assigns the new UUID before the sibling update, while the later commit
    # keeps creation and the single-active invariant atomic.
    await db.flush()
    await _ensure_single_active_resume(db, user.id, resume.id)
    await db.commit()
    await db.refresh(resume)
    return resume


@router.post("", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
async def create_resume_version(
    body: ResumeCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(func.max(Resume.version)).where(Resume.user_id == user.id)
    )
    latest_version = result.scalar_one_or_none() or 0
    next_version = latest_version + 1

    resume = Resume(
        user_id=user.id,
        version=next_version,
        title=body.title.strip()[:128],
        content=body.content.strip(),
        is_active=body.is_active,
    )
    db.add(resume)
    await db.flush()
    if body.is_active:
        await _ensure_single_active_resume(db, user.id, resume.id)
    await db.commit()
    await db.refresh(resume)
    return resume


@router.get("", response_model=list[ResumeOut])
async def list_resumes(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume)
        .where(Resume.user_id == user.id)
        .order_by(Resume.version.desc())
    )
    return list(result.scalars().all())


@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(
    resume_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    resume = result.scalar_one_or_none()
    if resume is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="简历不存在",
        )
    return resume


@router.patch("/{resume_id}", response_model=ResumeOut)
async def update_resume(
    resume_id: str,
    body: ResumeUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    resume = result.scalar_one_or_none()
    if resume is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="简历不存在",
        )

    if body.title is not None:
        resume.title = body.title.strip() or resume.title
    if body.is_active is not None:
        resume.is_active = body.is_active
        if body.is_active:
            await _ensure_single_active_resume(db, user.id, resume.id)

    await db.commit()
    await db.refresh(resume)
    return resume


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(
    resume_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    resume = result.scalar_one_or_none()
    if resume is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="简历不存在",
        )

    was_active = resume.is_active
    await db.delete(resume)
    await db.flush()

    if was_active:
        # Keep downstream chat defaults useful: deleting the active version
        # promotes the newest remaining version instead of leaving no selection.
        latest = await db.execute(
            select(Resume)
            .where(Resume.user_id == user.id)
            .order_by(Resume.version.desc())
            .limit(1)
        )
        fallback = latest.scalar_one_or_none()
        if fallback is not None:
            fallback.is_active = True

    await db.commit()
