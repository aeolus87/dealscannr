import uuid
from datetime import datetime, timezone

from bson import ObjectId
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from rag.utils.qdrant_payload_indexes import ensure_payload_indexes

COLLECTION = "dealscannr_chunks"


def ensure_collection(client: QdrantClient, vector_size: int) -> None:
    names = {c.name for c in client.get_collections().collections}
    if COLLECTION not in names:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
    ensure_payload_indexes(client, COLLECTION)


def upsert_chunks(
    client: QdrantClient,
    *,
    company_id: str,
    company_name: str,
    texts: list[str],
    vectors: list[list[float]],
    source_urls: list[str],
    source_type: str = "news",
    vector_size: int,
) -> int:
    ensure_collection(client, vector_size)
    now = datetime.now(timezone.utc).isoformat()
    points: list[PointStruct] = []
    default_url = source_urls[0] if source_urls else ""
    for i, (text, vec) in enumerate(zip(texts, vectors)):
        url = default_url
        if i < len(source_urls):
            url = source_urls[i]
        chunk_id = str(ObjectId())
        body = text[:12000]
        points.append(
            PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={
                    "company_id": company_id,
                    "company_name": company_name,
                    "chunk_id": chunk_id,
                    "raw_text": body,
                    "normalized_text": body,
                    "source_url": url,
                    "source_type": source_type,
                    "ingested_at": now,
                    "retrieved_at": now,
                    "freshness_score": 1.0,
                },
            )
        )
    if points:
        client.upsert(collection_name=COLLECTION, points=points)
    return len(points)
