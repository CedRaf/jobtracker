"""
Filtering, flagging and resume skill-matching rules.

What the rules look for comes from the scraper settings (settings.py:
editable in the dashboard, defaults in default_settings.json):
- DROP by title: each enabled title rule (seniority, internship, ...).
- DROP by description: night shift, US/foreign hours, language requirements
  (each can be switched off), and N+ years of experience.
- DROP hybrid/on-site outside Cebu (location_drop_reason), and (in
  scraper.py) a skill-match score below "min_match_score".
- FLAG: 3-4 years experience, off-stack roles, training bonds, blank work
  arrangement, previous employers, and positive signals.
LinkedIn jobs get their work arrangement from guess_work_arrangements().

The settings hold plain words and phrases; phrase_pattern() turns them into
regexes. How matching works (negation, parsing "3+ years", the patterns for
night shift, foreign hours, languages and positive signals) stays here.
"""

import html
import re

import settings as settings_module

I = re.IGNORECASE

# ---- Description checks (fixed patterns; on/off comes from the settings) ----

NIGHT_SHIFT = re.compile(
    r"\b(night[\s-]?shifts?|graveyard(?: shift)?|nsd|night shift differential|"
    r"night differential)\b", I)
LANGUAGE_REQUIRED = re.compile(
    r"\b(?:fluent|fluency|proficient|proficiency|native|business[\s-]level|advanced)\b"
    r"[^.\n]{0,25}\b(mandarin|chinese|japanese|korean|cantonese|german|french|spanish|"
    r"vietnamese|thai)\b|\b(?:jlpt|hsk|topik)\b", I)
NEGATION = re.compile(r"\b(no|not|without|non|never)\b[\s-]*$", I)

US_HOURS = re.compile(
    r"\b(us|u\.s\.|usa|american|uk)[\s-]*(?:shift|hours|time ?zone|business hours)\b|"
    r"\b(?:est|pst|cst|edt|pdt) (?:hours|shift|time ?zone)\b", I)

# "3+ years of experience", "minimum of five (5) years experience", "3-5 yrs exp"
EXPERIENCE = re.compile(
    r"\(?(\d{1,2})\)?\s*\+?\s*(?:(?:-|–|to)\s*\(?\d{1,2}\)?\s*)?\+?\s*"
    r"(?:years?|yrs?)\b(?:\s+(?:of\s+)?[a-z/&,\-\s]{0,40}?)?\s*(?:experience|exp\b)", I)
EXPERIENCE_AFTER = re.compile(
    r"\b(?:experience|exp\.?)\b[^.\n]{0,30}?(?:at least|minimum(?: of)?|min\.?|over)?\s*"
    r"\(?(\d{1,2})\)?\s*\+?\s*(?:years?|yrs?)\b", I)

TRAINING_BOND = re.compile(
    r"\b(training bond|bond(?:ed)? (?:period|agreement|contract)|service agreement|"
    r"training agreement|employment bond|return service)\b", I)

# Kept in code: the dashboard's flag categories (web/src/lib/flags.ts) list these.
POSITIVE = [
    ("fresh grads OK", re.compile(r"\bfresh(?:\s|-)?grad(?:uate)?s?\b", I)),
    ("no exp required", re.compile(r"\b(no (?:work )?experience (?:is )?(?:required|needed|necessary)|"
                                   r"without experience|with or without experience)\b", I)),
    ("entry level", re.compile(r"\bentry[\s-]level\b", I)),
    ("will train", re.compile(r"\b(will train|training (?:is )?provided|we(?:'ll| will) train|"
                              r"paid training|comprehensive training)\b", I)),
    ("honors preferred", re.compile(r"\b(latin honors?|cum laude|with honors)\b", I)),
]

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
FORM_LINK = re.compile(
    r"https?://(?:docs\.google\.com/forms|forms\.gle|forms\.office\.com|"
    r"[\w.-]*typeform\.com|[\w.-]*jotform\.com|[\w.-]*tally\.so)[^\s\"'<>)]*", I)


# ---- Settings -> patterns ----------------------------------------------------

def _phrase(phrase):
    """One phrase as a regex: spaces and hyphens match any mix of them (or none), '/' allows spaces."""
    out = []
    for part in re.split(r"(\s+|-|/)", phrase.strip().lower()):
        if not part:
            continue
        if part.isspace() or part == "-":
            out.append(r"[\s-]*")
        elif part == "/":
            out.append(r"\s*/\s*")
        else:
            out.append(re.escape(part))
    return "".join(out)


def phrase_pattern(phrases):
    """
    A case-insensitive pattern matching any of the phrases as whole words.
    Uses lookarounds rather than \\b so phrases like "c#" and ".net" work.
    Longer phrases are tried first, so the reported match is the most specific.
    """
    parts = sorted({_phrase(p) for p in phrases}, key=len, reverse=True)
    return re.compile(r"(?<!\w)(?:" + "|".join(parts) + r")(?!\w)", I) if parts else None


class Rules:
    """The settings compiled into patterns."""

    def __init__(self, settings):
        self.settings = settings
        self.title_rules = [
            (rule["label"], phrase_pattern(rule["words"]))
            for rule in settings["title_rules"] if rule["enabled"] and rule["words"]
        ]
        self.skills = [
            (s["name"], s["weight"], phrase_pattern(s["aliases"]), phrase_pattern(s["exclude"]),
             s["off_stack"])
            for s in settings["skills"]
        ]
        self.other_stacks = [
            (s["name"], phrase_pattern(s["aliases"]), s["off_stack"]) for s in settings["other_stacks"]
        ]
        self.previous_employer = phrase_pattern(settings["previous_employers"])
        self.checks = settings["checks"]
        self.experience = settings["experience"]


_active = None


def configure(settings=None):
    """
    Applies scraper settings (a full or partial settings dict; missing parts
    use the defaults). Raises settings.SettingsError if they're malformed.
    """
    global _active
    _active = Rules(settings_module.validate(settings or {}))
    return _active


def active():
    return _active or configure()


def _mentions(pattern, exclude, text):
    """True if pattern matches somewhere that isn't part of an excluded phrase."""
    if pattern is None:
        return False
    blocked = [m.span() for m in exclude.finditer(text)] if exclude else []
    return any(not any(s <= m.start() and m.end() <= e for s, e in blocked) for m in pattern.finditer(text))


# ---- helpers ---------------------------------------------------------------

def html_to_text(content):
    if not content:
        return ""
    text = re.sub(r"<\s*(br|/p|/li|/div|/h\d)\s*/?>", "\n", content, flags=I)
    text = re.sub(r"<li[^>]*>", "\n- ", text, flags=I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def _unnegated(pattern, text):
    """True if pattern matches somewhere not preceded by 'no'/'not'/'without'."""
    for m in pattern.finditer(text):
        before = text[max(0, m.start() - 20):m.start()]
        if not NEGATION.search(before):
            return True
    return False


def required_years(text):
    """Highest 'minimum years of experience' mentioned, or None."""
    years = []
    for rx in (EXPERIENCE, EXPERIENCE_AFTER):
        for m in rx.finditer(text):
            n = int(m.group(1))
            if 0 < n <= 15:
                years.append(n)
    return max(years) if years else None


def is_cebu(location):
    return "cebu" in (location or "").lower()


# For sources that don't say the work arrangement (LinkedIn when logged out).
ARRANGEMENT_TEXT = [
    ("Remote", re.compile(r"\b(remote|work[\s-]from[\s-]home|wfh|telecommut\w*)\b", I)),
    ("Hybrid", re.compile(r"\bhybrid\b", I)),
    ("On-site", re.compile(r"\b(on[\s-]?site|office[\s-]based|work(?:ing)? from (?:the )?office|"
                           r"report(?:ing)? to (?:the|our) office)\b", I)),
]


def guess_work_arrangements(text):
    """Arrangements mentioned in the job text (not negated), e.g. ["Remote", "Hybrid"]."""
    return [label for label, rx in ARRANGEMENT_TEXT if _unnegated(rx, text)]


# ---- rule stages -----------------------------------------------------------

def title_drop_reason(job):
    """Checks that only need the title. Returns a reason string or None."""
    title = job["title"] or ""
    for label, rx in active().title_rules:
        m = rx.search(title)
        if m:
            return f"{label} ({m.group(0)})"
    return None


def location_drop_reason(job):
    """Hybrid/on-site is only OK in Cebu; remote is OK anywhere."""
    arrangements = [a.lower() for a in job["work_arrangements"]]
    if not arrangements or "remote" in arrangements or is_cebu(job["location"]):
        return None
    return f"{'/'.join(job['work_arrangements'])} outside Cebu"


def evaluate(job, description):
    """
    Full evaluation after details are fetched.
    Returns (drop_reason or None, extra_fields dict).
    """
    rules = active()
    text = f"{job['title']}\n{description}"
    flags = []

    if rules.checks["night_shift"] == "drop" and _unnegated(NIGHT_SHIFT, text):
        m = NIGHT_SHIFT.search(text)
        return f"night shift ({m.group(0)})", {}

    years = required_years(description)
    drop_at, flag_at = rules.experience["drop_years"], rules.experience["flag_years"]
    if years is not None and drop_at is not None and years >= drop_at:
        return f"{years}+ years experience", {}
    if years is not None and flag_at is not None and years >= flag_at:
        flags.append(f"!{years}+ yrs exp")

    if rules.checks["foreign_hours"] == "drop" and _unnegated(US_HOURS, text):
        return f"US/foreign hours ({US_HOURS.search(text).group(0)})", {}
    if rules.checks["language_requirement"] == "drop":
        m = LANGUAGE_REQUIRED.search(text)
        if m:
            return f"language requirement ({m.group(0)})", {}
    if rules.checks["training_bond"] == "flag" and TRAINING_BOND.search(description):
        flags.append("!training bond")
    if not job["work_arrangements"]:
        flags.append("!no work arrangement listed")
    if rules.previous_employer and rules.previous_employer.search(job["company"] or ""):
        flags.append("!previous employer")

    matched, score, core_hits, off_stack_skills = [], 0, 0, []
    for name, weight, rx, exclude, is_off_stack in rules.skills:
        if _mentions(rx, exclude, text):
            matched.append(name)
            score += weight
            core_hits += weight == 3
            if is_off_stack:
                off_stack_skills.append(name)
    missing = [name for name, rx, _ in rules.other_stacks if rx.search(text)]
    off_stack_names = {name for name, _, is_off_stack in rules.other_stacks if is_off_stack}
    off_stack = [name for name in missing if name in off_stack_names] + off_stack_skills
    if off_stack and not core_hits:
        flags.append(f"!off-stack ({', '.join(off_stack)})")

    for label, rx in POSITIVE:
        if rx.search(text):
            flags.append(f"+{label}")

    return None, {
        "match_score": score,
        "matched_skills": ", ".join(matched),
        "missing_skills": ", ".join(missing),
        "flags": "; ".join(flags),
    }


def extract_emails(description, raw_html=""):
    found = []
    for e in EMAIL.findall(f"{description} {raw_html}"):
        e = e.strip(".").lower()
        if e.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
            continue
        if e not in found:
            found.append(e)
    return found[:3]


def extract_form_link(description, raw_html=""):
    m = FORM_LINK.search(f"{description} {raw_html}")
    return m.group(0) if m else ""
