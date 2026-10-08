"""Cloudflare R2 object storage via its S3-compatible API (Phase 17, Part C).

Uploads go browser -> R2 on a presigned PUT URL, so photo bytes never pass through the API.
Everything here is synchronous boto3; callers in async code use `run_in_threadpool`.
Presigning is pure local signing (no network); only head/delete touch R2.
"""

from functools import lru_cache
from typing import Any

import boto3
from botocore.config import Config

from app.config import settings

PRESIGN_TTL_SECONDS = 3600
ALLOWED_CONTENT_TYPES = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
}


class StorageNotConfiguredError(Exception):
    pass


def is_configured() -> bool:
    return bool(
        settings.r2_account_id
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket
    )


@lru_cache(maxsize=1)
def _client() -> Any:
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _require() -> Any:
    if not is_configured():
        raise StorageNotConfiguredError()
    return _client()


def presign_put(key: str, content_type: str, content_length: int) -> str:
    """URL the browser PUTs the file to. Content-Type and Content-Length are part of the
    signature, so the upload must match what the API approved (and its limits)."""
    return str(
        _require().generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.r2_bucket,
                "Key": key,
                "ContentType": content_type,
                "ContentLength": content_length,
            },
            ExpiresIn=PRESIGN_TTL_SECONDS,
        )
    )


def presign_get(key: str) -> str:
    return str(
        _require().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.r2_bucket, "Key": key},
            ExpiresIn=PRESIGN_TTL_SECONDS,
        )
    )


def public_url(key: str) -> str | None:
    base = settings.r2_public_base_url.rstrip("/")
    return f"{base}/{key}" if base else None


def object_size(key: str) -> int | None:
    """Size of an uploaded object, or None if it doesn't exist."""
    from botocore.exceptions import ClientError

    try:
        head = _require().head_object(Bucket=settings.r2_bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return int(head["ContentLength"])


def delete_objects(keys: list[str]) -> None:
    """Delete up to 1000 keys (S3 delete_objects limit). Missing keys are not an error."""
    if not keys:
        return
    resp = _require().delete_objects(
        Bucket=settings.r2_bucket,
        Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True},
    )
    if resp.get("Errors"):
        raise RuntimeError(f"R2 delete failed for {len(resp['Errors'])} object(s)")
