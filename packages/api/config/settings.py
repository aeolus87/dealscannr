from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# config/settings.py → parents[1] = packages/api, parents[3] = monorepo root
_HERE = Path(__file__).resolve()


def _dotenv_paths() -> tuple[str, ...]:
    api_dir = _HERE.parents[1]
    repo_root = _HERE.parents[3]
    paths: list[Path] = []
    if (repo_root / ".env").is_file():
        paths.append(repo_root / ".env")
    if (api_dir / ".env").is_file():
        paths.append(api_dir / ".env")
    if not paths:
        cwd_env = Path.cwd() / ".env"
        if cwd_env.is_file():
            paths.append(cwd_env)
    return tuple(str(p) for p in paths)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_dotenv_paths() or (".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "mongodb://localhost:5300/dealscannr"
    redis_url: str = "redis://localhost:5400"
    qdrant_url: str = "http://localhost:5500"
    qdrant_api_key: str | None = None
    # Groq is LLM-only. Do not use for embeddings.
    groq_api_key: str | None = None
    openai_api_key: str | None = None
    # openai: try OpenAI chat first when openai_api_key is set; groq: Groq only.
    llm_provider: str = "openai"
    together_api_key: str | None = None
    nomic_api_key: str | None = None
    firecrawl_api_key: str | None = None
    courtlistener_api_key: str | None = None
    github_token: str | None = None
    newsapi_key: str | None = None
    adzuna_app_id: str | None = None
    adzuna_api_key: str | None = None
    adzuna_country: str = "us"
    cors_origins: list[str] = ["http://localhost:5100", "http://127.0.0.1:5100"]
    # Public web origin for share links (path /share/{token} is on the SPA).
    public_app_url: str = "http://localhost:5100"

    jwt_secret: str = "dealscannr-dev-jwt-secret-min-32-chars-long"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 168

    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_pro_price_id: str = ""
    stripe_team_price_id: str = ""

    resend_api_key: str | None = None
    resend_from_email: str = "DealScannr <onboarding@resend.dev>"

    # Optional: set to enable GET /api/scans/{id}/debug with header X-DealScannr-Debug-Secret
    scan_debug_secret: str | None = None

    # Guest first scan: httpOnly cookie Secure flag (False for local HTTP)
    guest_cookie_secure: bool = False
    # Redis TTL for one guest scan per IP (seconds); default 7 days
    guest_scan_ip_window_seconds: int = 604800


settings = Settings()
