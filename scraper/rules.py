"""
Filtering, flagging and resume skill-matching rules.

What the rules look for comes from the scraper settings (settings.py:
editable in the dashboard, defaults in default_settings.json):
- DROP by title: each enabled title rule (seniority, internship, ...), unless
  the title also has one of that rule's "unless" words.
- DROP by description: night shift, US/foreign hours (not just "overlap with
  US hours"), language requirements (each can be switched off), and N+ years
  of experience.
- DROP hybrid/on-site outside Cebu (location_drop_reason), and a skill-match
  score below "min_match_score" (low_score_reason: not judged, but flagged,
  when the description is too short to score).
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
# "overlap with U.S. business hours" asks for a few shared hours, not a US shift.
OVERLAP = re.compile(r"\boverlap(?:s|ping)?\b[^.\n]{0,30}$", I)

US_HOURS = re.compile(
    r"\b(us|u\.s\.|usa|american|uk)[\s-]*(?:shift|hours|time ?zone|business hours)\b|"
    r"\b(?:est|pst|cst|edt|pdt) (?:hours|shift|time ?zone)\b", I)

# ---- Years of experience ----
# A number of years ("3", "three", "five (5)"), optionally a range or open end
# ("3-5", "2 to 4", "4+", "3 or more"), then "years"/"yrs" (also "2-years'").
# The first number is captured: a range's lower end is the minimum asked for.
NUMBER_WORDS = {w: n for n, w in enumerate(
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen".split(), 1)}
_NUMBER = r"(?:\d{1,2}|" + "|".join(NUMBER_WORDS) + r")"
_YEARS = (
    r"(?<![\w.,$])\(?(" + _NUMBER + r")\)?(?:\s*\(\d{1,2}\))?"
    r"(?:\s*(?:-|–|—|to)\s*\(?" + _NUMBER + r"\)?|\s+or\s+(?:more|above)|\s+and\s+above|\s+plus)?"
    # "2-years' experience" counts, but "a four-year degree" / "2-year program" don't.
    r"\s*\+?(?:\s*-\s*(?:years|yrs)|\s*(?:years?|yrs?))(?:['’]s?)?(?!\w)")
_EXPERIENCE_WORD = r"\b(?:experience\w*|exp)\b"
EXPERIENCE_PATTERNS = [
    # "3+ years of experience", "2–3 years' experience", "4 years of professional
    # full-stack development experience": the years, then "experience" in the same clause.
    re.compile(_YEARS + r"[^.\n;]{0,60}?" + _EXPERIENCE_WORD, I),
    # "Experience: minimum 2 years", "Professional Experience\n- 3-5 years".
    re.compile(_EXPERIENCE_WORD + r"[^.;]{0,30}?(?:at least|minimum(?: of)?|min\.?|over)?\s*" + _YEARS, I),
    # Requirement lines without the word "experience": "- 4+ years as a software
    # developer", "2 to 3 years in a client-facing role", "Must have 3+ years of
    # hands-on email work". Starts a (bulleted) line or follows a requirement word.
    re.compile(
        r"(?:^[ \t]*(?:[-–•·*▪●✓✔✅]+[ \t]*)?|\b(?:at least|minimum(?: of)?|min\.?|more than|must have|"
        r"requires?|requiring|needs?)\s+)(?:(?:at least|minimum(?: of)?|more than|roughly|around|about)\s+)?"
        + _YEARS +
        r"\s+(?:in|as|of|on|with|building|developing|working|doing|writing|managing|leading|running|using|"
        r"hands|professional|commercial|relevant|industry)\b", I | re.M),
    # A level or skill with its years in brackets: "Senior Engineer (5–10 years)", "Java (3 years)".
    re.compile(r"\(\s*" + _YEARS + r"\s*\)", I),
]

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
            (rule["label"], phrase_pattern(rule["words"]), phrase_pattern(rule["unless"]))
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


def _foreign_hours(text):
    """The first US/UK hours mention that isn't negated or only asking for overlap, or None."""
    for m in US_HOURS.finditer(text):
        before = text[max(0, m.start() - 40):m.start()]
        if not NEGATION.search(before[-20:]) and not OVERLAP.search(before):
            return m
    return None


def required_years(text):
    """Highest 'minimum years of experience' mentioned, or None."""
    years = []
    for rx in EXPERIENCE_PATTERNS:
        for m in rx.finditer(text):
            word = m.group(1).lower()
            n = NUMBER_WORDS[word] if word in NUMBER_WORDS else int(word)
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
    for label, rx, unless in active().title_rules:
        m = rx.search(title)
        if m and not (unless and unless.search(title)):
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

    if rules.checks["foreign_hours"] == "drop":
        m = _foreign_hours(text)
        if m:
            return f"US/foreign hours ({m.group(0)})", {}
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


# Some listings (e.g. LinkedIn reposts) carry only a short summary. A skill
# score from that says nothing, so the job is kept and flagged instead.
MIN_DESCRIPTION_CHARS = 600


def low_score_reason(extra, description, min_score):
    """
    The drop reason when the skill-match score is below min_score, or None.
    A description too short to judge isn't scored: the job is kept with a
    "!short description" flag (added to extra["flags"]).
    """
    if extra["match_score"] >= min_score:
        return None
    if len(description) < MIN_DESCRIPTION_CHARS:
        extra["flags"] = "; ".join(filter(None, [extra["flags"], "!short description"]))
        return None
    return f"low skill match (score {extra['match_score']})"


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
