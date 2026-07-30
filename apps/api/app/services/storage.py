from __future__ import annotations

import logging
from typing import Any

import boto3
from botocore.client import Config
import redis

from app.config import get_settings

logger = logging.getLogger("recallos.storage")


def s3_client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.minio_endpoint,
        aws_access_key_id=s.minio_access_key,
        aws_secret_access_key=s.minio_secret_key,
        region_name="us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def presigned_put(key: str, content_type: str, expires: int = 300) -> str:
    s = get_settings()
    return s3_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": s.aws_bucket_name,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=expires,
    )


def presigned_get(key: str, expires: int = 300) -> str:
    s = get_settings()
    return s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": s.aws_bucket_name, "Key": key},
        ExpiresIn=expires,
    )


def head_object(key: str) -> dict[str, Any]:
    s = get_settings()
    return s3_client().head_object(Bucket=s.aws_bucket_name, Key=key)


def delete_object(key: str) -> None:
    s = get_settings()
    s3_client().delete_object(Bucket=s.aws_bucket_name, Key=key)


async def put_object(key: str, body: bytes, content_type: str) -> None:
    s = get_settings()
    s3_client().put_object(
        Bucket=s.aws_bucket_name,
        Key=key,
        Body=body,
        ContentType=content_type,
    )


def redis_client() -> redis.Redis:
    s = get_settings()
    return redis.Redis.from_url(s.redis_url, decode_responses=True)


async def xadd_stream(stream: str, fields: dict[str, str]) -> str | None:
    try:
        r = redis_client()
        return r.xadd(stream, fields)
    except Exception as e:
        logger.error("xadd failed: %s", e)
        return None
