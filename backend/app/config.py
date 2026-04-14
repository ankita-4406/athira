from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    # Primary model; on 404 the client tries fallbacks (see llm_parse.py). Override with GEMINI_MODEL.
    gemini_model: str = "gemini-2.5-flash"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/google/oauth/callback"
    frontend_url: str = "http://localhost:5173"
    database_url: str = "sqlite:///./data/athira.db"


settings = Settings()
