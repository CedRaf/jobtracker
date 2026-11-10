"""
Scraper settings: search terms and filter rules, editable from the dashboard.

The dashboard saves them as versions in Supabase (scraper_settings_versions);
each run loads the newest one. default_settings.json holds the defaults, which
the migration also seeds as version 1. Anything missing from a saved version
falls back to the default, and validate() rejects anything malformed so a bad
edit can't break a run (the scraper then uses the defaults).

Rules are plain words and phrases, never regexes; rules.py turns them into
patterns.

"sources" switches each job site on or off and sets its start times; the
database scheduler (supabase/migrations/*_scheduler.sql) reads the times.
"""

import copy
import json
import re
from pathlib import Path

DEFAULTS_FILE = Path(__file__).resolve().parent / "default_settings.json"
SCHEMA = 1

DROP_OR_OFF = ("drop", "off")
CHECK_CHOICES = {
    "night_shift": DROP_OR_OFF,
    "foreign_hours": DROP_OR_OFF,
    "language_requirement": DROP_OR_OFF,
    "training_bond": ("flag", "off"),
}

# Start times are Manila time on a 15-minute grid, because the scheduler checks
# every 15 minutes. GitHub keeps only one run waiting behind a running one (a
# newer waiting run replaces it), so different start times must be at least
# MIN_GAP_MINUTES apart; sites that share a time go into one run.
START_TIME = re.compile(r"^([01]\d|2[0-3]):(00|15|30|45)$")
MAX_RUNS_PER_DAY = 6
MIN_GAP_MINUTES = 30

# Sites with a Cebu search that can also search remote jobs outside Cebu.
# Himalayas only lists remote jobs, so it has no such switch.
REMOTE_SEARCH_SITES = ("jobstreet", "linkedin")


class SettingsError(ValueError):
    """The settings are malformed; the message says where."""


def load_defaults():
    return json.loads(DEFAULTS_FILE.read_text(encoding="utf-8"))


# ---- small validators -------------------------------------------------------

def _int(value, where, low, high, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise SettingsError(f"{where} must be a whole number from {low} to {high}")
    return value


def _bool(value, where):
    if not isinstance(value, bool):
        raise SettingsError(f"{where} must be true or false")
    return value


def _text(value, where):
    if not isinstance(value, str) or not value.strip():
        raise SettingsError(f"{where} must be non-empty text")
    return value.strip()


def _words(value, where, allow_empty=False):
    """A list of words/phrases: trimmed, de-duplicated (ignoring case), each with a letter or digit."""
    if not isinstance(value, list):
        raise SettingsError(f"{where} must be a list")
    words, seen = [], set()
    for i, word in enumerate(value):
        word = _text(word, f"{where}[{i}]")
        if not any(ch.isalnum() for ch in word):
            raise SettingsError(f"{where}: {word!r} has no letters or digits")
        if word.lower() not in seen:
            seen.add(word.lower())
            words.append(word)
    if not words and not allow_empty:
        raise SettingsError(f"{where} needs at least one entry")
    return words


def _unique(items, key, where):
    seen = set()
    for item in items:
        name = item[key].lower()
        if name in seen:
            raise SettingsError(f"{where}: {item[key]!r} appears twice")
        seen.add(name)
    return items


def _dict(value, where):
    if not isinstance(value, dict):
        raise SettingsError(f"{where} must be an object")
    return value


# ---- sections ------------------------------------------------------------------

def _search(raw, default):
    raw = _dict(raw, "search")
    get = lambda key: raw.get(key, default[key])  # noqa: E731
    return {
        "keywords": _words(get("keywords"), "search.keywords"),
        "listed_within_days": _int(get("listed_within_days"), "search.listed_within_days", 1, 30),
        "max_pages_per_search": _int(get("max_pages_per_search"), "search.max_pages_per_search", 1, 10),
        "radius_km": _int(get("radius_km"), "search.radius_km", 1, 500),
        "remote_elsewhere": _remote_elsewhere(raw, default["remote_elsewhere"]),
    }


def _remote_elsewhere(search, default):
    """Per site: also search remote jobs outside Cebu?

    Versions saved before 2026-11-06 have one switch for every site
    (search_remote_elsewhere); it applies to each of them.
    """
    if "remote_elsewhere" not in search and "search_remote_elsewhere" in search:
        shared = _bool(search["search_remote_elsewhere"], "search.search_remote_elsewhere")
        return {site: shared for site in REMOTE_SEARCH_SITES}
    raw = _dict(search.get("remote_elsewhere", default), "search.remote_elsewhere")
    return {site: _bool(raw.get(site, default[site]), f"search.remote_elsewhere.{site}")
            for site in REMOTE_SEARCH_SITES}


def _entry_level(raw, default):
    """Only used by the dashboard (to highlight and sort jobs); validated here so versions stay consistent."""
    raw = _dict(raw, "entry_level")
    return {
        "title_words": _words(raw.get("title_words", default["title_words"]), "entry_level.title_words",
                              allow_empty=True),
        "description_signals": _bool(raw.get("description_signals", default["description_signals"]),
                                     "entry_level.description_signals"),
    }


def _experience(raw, default):
    raw = _dict(raw, "experience")
    flag = _int(raw.get("flag_years", default["flag_years"]), "experience.flag_years", 1, 15, allow_none=True)
    drop = _int(raw.get("drop_years", default["drop_years"]), "experience.drop_years", 1, 15, allow_none=True)
    if flag is not None and drop is not None and flag >= drop:
        raise SettingsError("experience.flag_years must be lower than experience.drop_years")
    return {"flag_years": flag, "drop_years": drop}


def _checks(raw, default):
    raw = _dict(raw, "checks")
    checks = {}
    for key, choices in CHECK_CHOICES.items():
        value = raw.get(key, default[key])
        if value not in choices:
            raise SettingsError(f"checks.{key} must be one of: {', '.join(choices)}")
        checks[key] = value
    return checks


def _title_rules(raw):
    if not isinstance(raw, list):
        raise SettingsError("title_rules must be a list")
    rules = []
    for i, rule in enumerate(raw):
        where = f"title_rules[{i}]"
        rule = _dict(rule, where)
        enabled = _bool(rule.get("enabled", True), f"{where}.enabled")
        rules.append({
            "label": _text(rule.get("label"), f"{where}.label"),
            "enabled": enabled,
            "words": _words(rule.get("words", []), f"{where}.words", allow_empty=not enabled),
            # Keep the job when its title also has one of these (e.g. "developer").
            "unless": _words(rule.get("unless", []), f"{where}.unless", allow_empty=True),
        })
    return _unique(rules, "label", "title_rules")


def _skills(raw):
    if not isinstance(raw, list):
        raise SettingsError("skills must be a list")
    skills = []
    for i, skill in enumerate(raw):
        where = f"skills[{i}]"
        skill = _dict(skill, where)
        weight = skill.get("weight")
        if weight not in (1, 2, 3) or isinstance(weight, bool):
            raise SettingsError(f"{where}.weight must be 1 (adjacent), 2 (secondary) or 3 (core)")
        skills.append({
            "name": _text(skill.get("name"), f"{where}.name"),
            "weight": weight,
            "aliases": _words(skill.get("aliases", []), f"{where}.aliases"),
            "exclude": _words(skill.get("exclude", []), f"{where}.exclude", allow_empty=True),
            "off_stack": _bool(skill.get("off_stack", False), f"{where}.off_stack"),
        })
    return _unique(skills, "name", "skills")


def _other_stacks(raw):
    if not isinstance(raw, list):
        raise SettingsError("other_stacks must be a list")
    stacks = []
    for i, stack in enumerate(raw):
        where = f"other_stacks[{i}]"
        stack = _dict(stack, where)
        stacks.append({
            "name": _text(stack.get("name"), f"{where}.name"),
            "aliases": _words(stack.get("aliases", []), f"{where}.aliases"),
            "off_stack": _bool(stack.get("off_stack", False), f"{where}.off_stack"),
        })
    return _unique(stacks, "name", "other_stacks")


def _minutes(time):
    hours, minutes = time.split(":")
    return int(hours) * 60 + int(minutes)


def _clock(minutes):
    return f"{minutes // 60 % 24:02d}:{minutes % 60:02d}"


def _sources(raw, default):
    raw = _dict(raw, "sources")
    unknown = sorted(set(raw) - set(default))
    if unknown:
        raise SettingsError(f"sources: unknown job site {unknown[0]!r}")
    sources = {}
    for site, site_default in default.items():
        where = f"sources.{site}"
        site_raw = _dict(raw.get(site, site_default), where)
        times = site_raw.get("times", site_default["times"])
        if not isinstance(times, list):
            raise SettingsError(f"{where}.times must be a list")
        for i, time in enumerate(times):
            if not isinstance(time, str) or not START_TIME.match(time.strip()):
                raise SettingsError(
                    f"{where}.times[{i}] must be a time like 09:00, on the hour or at :15, :30 or :45")
        times = sorted({time.strip() for time in times}, key=_minutes)
        if len(times) > MAX_RUNS_PER_DAY:
            raise SettingsError(f"{where}.times: at most {MAX_RUNS_PER_DAY} runs a day")
        on = _bool(site_raw.get("enabled", site_default["enabled"]), f"{where}.enabled")
        sources[site] = {"enabled": on, "times": times}

    starts = sorted({_minutes(t) for s in sources.values() if s["enabled"] for t in s["times"]})
    # Around the clock too: 23:45 and 00:00 are 15 minutes apart.
    for earlier, later in zip(starts, starts[1:] + starts[:1], strict=True):
        gap = (later - earlier) % 1440
        if 0 < gap < MIN_GAP_MINUTES:
            raise SettingsError(
                f"sources: start times {_clock(earlier)} and {_clock(later)} are less than {MIN_GAP_MINUTES} "
                "minutes apart; use the same time or keep them further apart")
    return sources


def enabled(settings, source):
    """Whether this job site is switched on in the settings."""
    return settings["sources"][source]["enabled"]


def validate(raw):
    """
    Returns complete, cleaned settings: the defaults with every section in
    `raw` validated and swapped in. Raises SettingsError if anything is off.
    """
    defaults = load_defaults()
    raw = _dict(raw if raw is not None else {}, "settings")
    if raw.get("schema", SCHEMA) != SCHEMA:
        raise SettingsError(f"unsupported settings schema {raw.get('schema')!r} (expected {SCHEMA})")
    # Sections missing from raw come from the defaults; every section is validated either way.
    merged = {**copy.deepcopy(defaults), **raw}
    return {
        "schema": SCHEMA,
        "search": _search(merged["search"], defaults["search"]),
        "entry_level": _entry_level(merged["entry_level"], defaults["entry_level"]),
        "min_match_score": _int(merged["min_match_score"], "min_match_score", 0, 100),
        "experience": _experience(merged["experience"], defaults["experience"]),
        "checks": _checks(merged["checks"], defaults["checks"]),
        "title_rules": _title_rules(merged["title_rules"]),
        "skills": _skills(merged["skills"]),
        "other_stacks": _other_stacks(merged["other_stacks"]),
        "previous_employers": _words(merged["previous_employers"], "previous_employers", allow_empty=True),
        "sources": _sources(merged["sources"], defaults["sources"]),
    }


def search_config(settings):
    """The search settings under the names scraper.py and LinkedIn_Scraper.py use."""
    s = settings["search"]
    return {
        "keywords": s["keywords"],
        "listed_within_days": s["listed_within_days"],
        "max_pages_per_search": s["max_pages_per_search"],
        "cebu_distance_kms": s["radius_km"],
        "remote_elsewhere": s["remote_elsewhere"],
        "min_match_score": settings["min_match_score"],
    }
