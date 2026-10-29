from backend.config import apply_env_overrides, load_config


def test_env_overrides_nested_and_typed():
    data = {"engine": {"depth": 18, "path": "x"}}
    env = {
        "PLYREVIEW__ENGINE__PATH": "stockfish",
        "PLYREVIEW__ENGINE__DEPTH": "12",
        "PLYREVIEW__API__CORS_ORIGINS": '["http://a"]',
        "OTHER": "ignored",
    }
    out = apply_env_overrides(data, env)
    assert out["engine"] == {"depth": 12, "path": "stockfish"}
    assert out["api"]["cors_origins"] == ["http://a"]


def test_repo_config_loads_and_resolves_paths(monkeypatch):
    monkeypatch.setenv("PLYREVIEW__ENGINE__THREADS", "2")
    cfg = load_config()
    assert cfg.engine.threads == 2
    assert cfg.storage.cache_dir.is_absolute()
    assert cfg.classification.excellent < cfg.classification.good < cfg.classification.mistake
