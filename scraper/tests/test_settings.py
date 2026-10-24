import copy
import json
import re
from pathlib import Path

import pytest

import rules
import settings
import sinks

ROOT = Path(__file__).resolve().parents[2]


def defaults():
    return settings.load_defaults()


# ---- validate ------------------------------------------------------------------


def test_defaults_are_valid_and_complete():
    clean = settings.validate({})
    assert clean["search"]["keywords"] == defaults()["search"]["keywords"]
    assert all("exclude" in s and "off_stack" in s for s in clean["skills"])


def test_missing_sections_and_keys_fall_back_to_defaults():
    clean = settings.validate({"search": {"listed_within_days": 7}, "unknown": 1})
    assert clean["search"]["listed_within_days"] == 7
    assert clean["search"]["keywords"] == defaults()["search"]["keywords"]
    assert "unknown" not in clean


def test_words_are_trimmed_and_deduplicated():
    clean = settings.validate({"previous_employers": [" Acme ", "acme", "Globex"]})
    assert clean["previous_employers"] == ["Acme", "Globex"]


@pytest.mark.parametrize("change, message", [
    ({"search": {"keywords": []}}, "search.keywords needs at least one entry"),
    ({"search": {"listed_within_days": 0}}, "listed_within_days"),
    ({"min_match_score": "3"}, "min_match_score"),
    ({"experience": {"flag_years": 5, "drop_years": 5}}, "lower than"),
    ({"checks": {"night_shift": "flag"}}, "checks.night_shift"),
    ({"title_rules": [{"label": "a", "words": ["x"]}, {"label": "A", "words": ["y"]}]}, "appears twice"),
    ({"title_rules": [{"label": "a", "enabled": True, "words": []}]}, "needs at least one entry"),
    ({"skills": [{"name": "Go", "weight": 4, "aliases": ["go"]}]}, "weight"),
    ({"skills": [{"name": "Go", "weight": True, "aliases": ["go"]}]}, "weight"),
    ({"other_stacks": [{"name": "X", "aliases": ["--"]}]}, "no letters or digits"),
    ({"schema": 2}, "schema"),
    ("not an object", "must be an object"),
])
def test_invalid_settings_are_rejected(change, message):
    with pytest.raises(settings.SettingsError, match=message):
        settings.validate(change)


def test_a_disabled_title_rule_may_have_no_words():
    clean = settings.validate({"title_rules": [{"label": "x", "enabled": False, "words": []}]})
    assert clean["title_rules"] == [{"label": "x", "enabled": False, "words": []}]


def test_search_config_uses_the_scrapers_names():
    clean = settings.validate({"search": {"radius_km": 25, "search_remote_elsewhere": False}})
    cfg = settings.search_config(clean)
    assert cfg["cebu_distance_kms"] == 25
    assert cfg["search_remote_outside_cebu"] is False
    assert cfg["min_match_score"] == defaults()["min_match_score"]


# ---- the same defaults everywhere -----------------------------------------------------


def test_migration_seeds_the_defaults():
    # Sections added after the migration (entry_level) aren't in the seed;
    # versions without them use the defaults, so the rest must match exactly.
    sql = next((ROOT / "supabase" / "migrations").glob("*_scraper_settings.sql")).read_text(encoding="utf-8")
    seed = json.loads(re.search(r"\$settings\$(.*?)\$settings\$", sql, re.S).group(1))
    added_later = {"entry_level"}
    assert seed == {k: v for k, v in defaults().items() if k not in added_later}
    assert settings.validate(seed)["entry_level"] == defaults()["entry_level"]


def test_dashboard_copy_matches_the_defaults():
    web_copy = ROOT / "web" / "src" / "data" / "defaultSettings.json"
    assert json.loads(web_copy.read_text(encoding="utf-8")) == defaults()


# ---- settings change what the rules do ------------------------------------------------


def job(**overrides):
    return {"title": "Junior Developer", "company": "Acme", "location": "Cebu City, Cebu",
            "work_arrangements": ["On-site"], **overrides}


def test_disabling_a_title_rule_keeps_those_jobs():
    assert rules.title_drop_reason(job(title="Software Developer Intern"))
    custom = copy.deepcopy(defaults()["title_rules"])
    next(r for r in custom if r["label"] == "internship")["enabled"] = False
    rules.configure({"title_rules": custom})
    assert rules.title_drop_reason(job(title="Software Developer Intern")) is None


def test_added_title_words_drop_jobs():
    extra = {"label": "game dev", "enabled": True, "words": ["unity", "game developer"]}
    custom = defaults()["title_rules"] + [extra]
    rules.configure({"title_rules": custom})
    assert rules.title_drop_reason(job(title="Junior Game-Developer")) == "game dev (Game-Developer)"


def test_description_checks_can_be_switched_off():
    text = "Night shift role. Must be fluent in Japanese. 6 years of experience."
    assert rules.evaluate(job(), text)[0].startswith("night shift")
    rules.configure({"checks": {"night_shift": "off", "language_requirement": "off"},
                     "experience": {"flag_years": None, "drop_years": None}})
    reason, extra = rules.evaluate(job(), text)
    assert reason is None and "yrs exp" not in extra["flags"]


def test_experience_thresholds_are_configurable():
    rules.configure({"experience": {"flag_years": 2, "drop_years": 4}})
    assert rules.evaluate(job(), "At least 4 years of experience.")[0] == "4+ years experience"
    assert "!2+ yrs exp" in rules.evaluate(job(), "2 years of experience")[1]["flags"]


def test_skills_with_aliases_weights_and_exclusions():
    rules.configure({"skills": [
        {"name": "React", "weight": 3, "aliases": ["react"], "exclude": ["react native"]},
        {"name": "Elixir", "weight": 2, "aliases": ["elixir", "phoenix framework"]},
    ]})
    _, extra = rules.evaluate(job(), "React Native app, Phoenix-Framework backend")
    assert extra["matched_skills"] == "Elixir"
    assert extra["match_score"] == 2
    _, extra = rules.evaluate(job(), "React and React Native")
    assert extra["matched_skills"] == "React"


# ---- loading from Supabase -------------------------------------------------------------


class FakeClient:
    def __init__(self, rows=None, error=None):
        self.rows, self.error = rows, error

    def select(self, table, params):
        assert table == "scraper_settings_versions" and params["order"] == "version.desc"
        if self.error:
            raise self.error
        return self.rows


@pytest.fixture
def client(monkeypatch):
    def use(fake):
        monkeypatch.setattr(sinks, "supabase_client", lambda secrets: fake)
    return use


def test_load_settings_uses_the_newest_saved_version(client):
    client(FakeClient([{"version": 7, "settings": {"min_match_score": 9}}]))
    loaded, version = sinks.load_settings({})
    assert version == 7 and loaded["min_match_score"] == 9


@pytest.mark.parametrize("fake", [
    None,                                                    # no credentials
    FakeClient([]),                                          # nothing saved
    FakeClient(error=RuntimeError("Supabase down")),         # can't fetch
    FakeClient([{"version": 3, "settings": {"min_match_score": -1}}]),  # invalid
])
def test_load_settings_falls_back_to_the_defaults(client, fake):
    client(fake)
    loaded, version = sinks.load_settings({})
    assert version is None and loaded == settings.validate({})
