"""
Filtering, flagging and resume skill-matching rules.

Decisions:
- DROP: seniority titles, internships, network/IT/non-dev and other off-target
  role types, foreign-language requirements, night shift / graveyard / NSD,
  US/foreign hours, 5+ years experience, hybrid/on-site outside Cebu, and
  (in scraper.py) a skill-match score below config "min_match_score".
  LinkedIn jobs get their work arrangement from guess_work_arrangements().
- FLAG: 3-4 years experience, off-stack roles, training bonds, blank work
  arrangement, previous employers (config "previous_employers"), and
  positive signals.

Patterns are plain regexes so they are easy to tweak.
"""

import html
import re

I = re.IGNORECASE

# ---- Title-only drops (checked before fetching job details) ----------------

SENIORITY_TITLE = re.compile(
    r"\b(senior|sr\.?|snr|lead|principal|staff (?:software )?engineer|manager|"
    r"architect|head of|mid[\s-]?level|director|supervisor|vp)\b", I)

# (reason label, title pattern). Tuned from the rows marked "Skip" in the sheet.
TITLE_DROPS = [(label, re.compile(p, I)) for label, p in [
    ("internship", r"\b(intern|interns|internship|ojt|on[\s-]the[\s-]job training|practicum)\b"),
    ("non-dev / IT role",
     r"\b(it support|technical support|tech support|help ?desk|desktop support|"
     r"service desk|network (?:engineer|administrator|admin|technician|specialist)|"
     r"system(?:s)? administrator|sysadmin|it staff|it specialist|it technician|"
     r"it assistant|computer technician|noc|field engineer|"
     r"sales|instructor|teacher|tutor|data encoder|data entry|customer service|"
     r"virtual assistant|call center|csr)\b"),
    ("support role",
     r"\b(application support|support engineer|support analyst|l[123]\s*/\s*l[123]|l[23] support)\b"),
    ("analyst role", r"\b(systems? analy(?:sis|st)|business analyst|qa analyst)\b"),
    ("data/platform role",
     r"\b(data engineer|integration engineer|platform engineer|databricks|data analyst|"
     r"devops|site reliability|sre|cloud engineer|infrastructure engineer)\b"),
    ("automation/low-code role",
     r"\b(automation (?:engineer|specialist)|rpa|power automate|power apps|servicenow|"
     r"salesforce admin(?:istrator)?|erpnext|frappe|odoo)\b"),
    ("design/content role",
     r"\b(designer|ux|ui/ux|ux/ui|graphic design|seo|wordpress|web editor|"
     r"content (?:writer|creator|editor|moderator|specialist|manager))\b"),
    ("non-dev AI role",
     r"\b(annotator|annotation|ai trainer|data label(?:l)?(?:ing|er)|ai assistant|"
     r"ai (?:process|optimi[sz]ation|operations)|prompt (?:writer|rater)|rater)\b"),
    ("language requirement",
     r"\b(mandarin|chinese|japanese|korean|cantonese|german|french|spanish|vietnamese|thai|bilingual)\b"),
    ("spam/not a job", r"\b(earn from|unused code|founders?|side income|commission only)\b"),
]]

# ---- Description checks ----------------------------------------------------

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

POSITIVE = [
    ("fresh grads OK", re.compile(r"\bfresh(?:\s|-)?grad(?:uate)?s?\b", I)),
    ("no exp required", re.compile(r"\b(no (?:work )?experience (?:is )?(?:required|needed|necessary)|"
                                   r"without experience|with or without experience)\b", I)),
    ("entry level", re.compile(r"\bentry[\s-]level\b", I)),
    ("will train", re.compile(r"\b(will train|training (?:is )?provided|we(?:'ll| will) train|"
                              r"paid training|comprehensive training)\b", I)),
    ("honors preferred", re.compile(r"\b(latin honors?|cum laude|with honors)\b", I)),
]

# Set from config "previous_employers" by configure(); None = no flag.
PREVIOUS_EMPLOYER = None


def configure(cfg):
    """Applies the settings from config.json that the rules depend on."""
    global PREVIOUS_EMPLOYER
    names = cfg.get("previous_employers") or []
    PREVIOUS_EMPLOYER = (re.compile(r"\b(" + "|".join(map(re.escape, names)) + r")\b", I)
                         if names else None)

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
FORM_LINK = re.compile(
    r"https?://(?:docs\.google\.com/forms|forms\.gle|forms\.office\.com|"
    r"[\w.-]*typeform\.com|[\w.-]*jotform\.com|[\w.-]*tally\.so)[^\s\"'<>)]*", I)

# ---- Resume skills (weights: core 3, secondary 2, adjacent 1) -------------

SKILLS = [
    # core
    ("TypeScript", 3, r"\btypescript\b"),
    ("JavaScript", 3, r"\bjavascript\b|\bes6\b"),
    ("React", 3, r"\breact(?:\.?js)?\b(?!\s*native)"),
    ("C#", 3, r"\bc#|\bc sharp\b"),
    (".NET", 3, r"(?<![\w])(?:asp)?\.net\b|\bdotnet\b"),
    ("Node.js", 3, r"\bnode(?:\.?js)?\b"),
    ("Express", 3, r"\bexpress\.?js\b|\bnode(?:\.?js)?\s*(?:/|,|and|&)\s*express\b"),
    ("PostgreSQL", 3, r"\bpostgre(?:s|sql)?\b"),
    ("MySQL", 3, r"\bmysql\b"),
    ("SQL", 3, r"\bsql\b"),
    ("Prisma", 3, r"\bprisma\b"),
    ("Drizzle", 3, r"\bdrizzle\b"),
    # secondary
    ("Python", 2, r"\bpython\b"),
    ("React Native", 2, r"\breact[\s-]native\b"),
    ("AI/LLM", 2, r"\b(?:llms?|large language models?|generative ai|gen ?ai|rag|"
                  r"retrieval[\s-]augmented|machine learning|ai)\b"),
    ("LangChain", 2, r"\blangchain\b"),
    ("Neo4j", 2, r"\bneo4j\b"),
    ("Vector DB", 2, r"\b(?:milvus|pinecone|weaviate|qdrant|vector (?:db|database))\b"),
    ("pandas", 2, r"\bpandas\b"),
    ("scikit-learn", 2, r"\bscikit[\s-]?learn\b|\bsklearn\b"),
    ("REST API", 2, r"\brest(?:ful)?\s*apis?\b"),
    ("WebSockets", 2, r"\bweb\s?sockets?\b|\bsocket\.io\b"),
    ("Git", 2, r"\bgit(?:hub|lab)?\b"),
    # adjacent
    ("Java", 1, r"\bjava\b"),
    ("Azure", 1, r"\bazure\b"),
    ("Postman", 1, r"\bpostman\b"),
    ("Vercel", 1, r"\bvercel\b"),
]
SKILLS = [(name, weight, re.compile(p, I)) for name, weight, p in SKILLS]

# Stacks not on the resume. OFF_STACK ones trigger the "off-stack" flag when a
# job mentions them and none of your core skills.
MISSING = [
    ("PHP", r"\bphp\b"), ("Laravel", r"\blaravel\b"), ("Spring", r"\bspring(?:\s?boot)?\b"),
    ("Angular", r"\bangular(?:js)?\b"), ("Vue", r"\bvue(?:\.?js)?\b"), ("Next.js", r"\bnext\.?js\b"),
    ("Ruby/Rails", r"\bruby\b|\brails\b"), ("Go", r"\bgolang\b"), ("Kotlin", r"\bkotlin\b"),
    ("Swift", r"\bswift\b"), ("Flutter", r"\bflutter\b|\bdart\b"), ("Django", r"\bdjango\b"),
    ("Flask", r"\bflask\b"), ("FastAPI", r"\bfastapi\b"), ("MongoDB", r"\bmongo(?:db)?\b"),
    ("AWS", r"\baws\b|\bamazon web services\b"), ("Docker", r"\bdocker\b"),
    ("Kubernetes", r"\bkubernetes\b|\bk8s\b"), ("Salesforce", r"\bsalesforce\b|\bapex\b"),
    ("SAP/ABAP", r"\bsap\b|\babap\b"), ("COBOL", r"\bcobol\b|\bmainframe\b"),
    ("WordPress", r"\bwordpress\b"), ("Shopify", r"\bshopify\b"), ("Magento", r"\bmagento\b"),
    ("Power Platform", r"\bpower ?apps\b|\bpower automate\b"), ("RPA", r"\buipath\b|\brpa\b"),
    ("ServiceNow", r"\bservicenow\b"), ("ERPNext/Odoo", r"\berpnext\b|\bfrappe\b|\bodoo\b"),
]
MISSING = [(name, re.compile(p, I)) for name, p in MISSING]
OFF_STACK = {"PHP", "Laravel", "Spring", "Java", "Salesforce", "SAP/ABAP", "COBOL", "WordPress",
             "ServiceNow", "ERPNext/Odoo"}


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
    m = SENIORITY_TITLE.search(title)
    if m:
        return f"seniority title ({m.group(0)})"
    for label, rx in TITLE_DROPS:
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
    text = f"{job['title']}\n{description}"
    flags = []

    if _unnegated(NIGHT_SHIFT, text):
        m = NIGHT_SHIFT.search(text)
        return f"night shift ({m.group(0)})", {}

    years = required_years(description)
    if years is not None and years >= 5:
        return f"{years}+ years experience", {}
    if years is not None and years >= 3:
        flags.append(f"!{years}+ yrs exp")

    if _unnegated(US_HOURS, text):
        return f"US/foreign hours ({US_HOURS.search(text).group(0)})", {}
    m = LANGUAGE_REQUIRED.search(text)
    if m:
        return f"language requirement ({m.group(0)})", {}
    if TRAINING_BOND.search(description):
        flags.append("!training bond")
    if not job["work_arrangements"]:
        flags.append("!no work arrangement listed")
    if PREVIOUS_EMPLOYER and PREVIOUS_EMPLOYER.search(job["company"] or ""):
        flags.append("!previous employer")

    matched, score, core_hits = [], 0, 0
    for name, weight, rx in SKILLS:
        if rx.search(text):
            matched.append(name)
            score += weight
            core_hits += weight == 3
    missing = [name for name, rx in MISSING if rx.search(text)]
    off_stack = [s for s in missing + (["Java"] if "Java" in matched else []) if s in OFF_STACK]
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
