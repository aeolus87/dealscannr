"""Payload indexes for filtered vector search (scan_id / entity_id / company_id)."""

from __future__ import annotations

import logging

from qdrant_client import QdrantClient
from qdrant_client.models import PayloadSchemaType

logger = logging.getLogger(__name__)

_KEYWORD_FIELDS = ("scan_id", "entity_id", "company_id")


def ensure_payload_indexes(client: QdrantClient, collection_name: str) -> None:
    for field_name in _KEYWORD_FIELDS:
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=PayloadSchemaType.KEYWORD,
            )
        except Exception as e:
            logger.warning(
                "qdrant_payload_index_failed field=%s collection=%s error=%s",
                field_name,
                collection_name,
                e,
            )
