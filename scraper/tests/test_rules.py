import pytest

import rules

# ---- title_drop_reason -----------------------------------------------------


@pytest.mark.parametrize("title", [
    "Junior Developer",
    "Associate Software Engineer",
    "Software Engineer Trainee",
    "Junior React Developer",
    "AI Engineer",
])
def test_junior_titles_are_kept(make_job, title):
    assert rules.title_drop_reason(make_job(title=title)) is None


@pytest.mark.parametrize("title, label", [
    ("Senior Software Engineer", "seniority title"),
    ("Sr. Developer", "seniority title"),
    ("Tech Lead", "seniority title"),
    ("Mid-Level .NET Developer", "seniority title"),
    ("Software Developer Intern", "internship"),
    ("IT Support Specialist", "non-dev / IT role"),
    ("Network Engineer", "non-dev / IT role"),
    ("L2 Support Engineer", "support role"),
    ("Business Analyst", "analyst role"),
    ("DevOps Engineer", "data/platform role"),
    ("Power Automate Developer", "automation/low-code role"),
    ("UI/UX Designer", "design/content role"),
    ("Annotator/AI Trainer", "non-dev AI role"),
    ("Japanese Bilingual Developer", "language requirement"),
    ("Earn From Your Unused Code", "spam/not a job"),
])
def test_title_drops(make_job, title, label):
    reason = rules.title_drop_reason(make_job(title=title))
    assert reason is not None and reason.startswith(label)


def test_title_drop_handles_missing_title(make_job):
    assert rules.title_drop_reason(make_job(title=None)) is None


# ---- location_drop_reason --------------------------------------------------


@pytest.mark.parametrize("location, arrangements, dropped", [
    ("Cebu City, Cebu", ["On-site"], False),
    ("Cebu City, Cebu", ["Hybrid"], False),
    ("Makati, Metro Manila", ["Remote"], False),
    ("Makati, Metro Manila", ["Hybrid", "Remote"], False),
    ("Makati, Metro Manila", [], False),  # blank arrangement: kept and flagged later
    ("Makati, Metro Manila", ["On-site"], True),
    ("Taguig, Metro Manila", ["Hybrid"], True),
])
def test_location_rule(make_job, location, arrangements, dropped):
    reason = rules.location_drop_reason(make_job(location=location, work_arrangements=arrangements))
    assert (reason is not None) == dropped


def test_location_reason_names_the_arrangement(make_job):
    job = make_job(location="Pasig, Metro Manila", work_arrangements=["Hybrid"])
    assert rules.location_drop_reason(job) == "Hybrid outside Cebu"


# ---- required_years --------------------------------------------------------


@pytest.mark.parametrize("text, years", [
    ("At least 3 years of experience in web development", 3),
    ("3+ years experience with React", 3),
    ("Minimum of five (5) years experience", 5),
    ("2-4 yrs exp in .NET", 2),
    ("Experience: minimum 2 years", 2),
    ("1 year of experience; 4+ years of professional experience preferred", 4),
    ("Fresh graduates are welcome", None),
    ("Founded 20 years ago, we build software", None),
])
def test_required_years(text, years):
    assert rules.required_years(text) == years


# ---- evaluate: drops -------------------------------------------------------


@pytest.mark.parametrize("description, reason_start", [
    ("This role is on a night shift schedule.", "night shift"),
    ("With NSD and HMO.", "night shift"),
    ("Must be willing to work graveyard shift.", "night shift"),
    ("Work during US business hours.", "US/foreign hours"),
    ("Aligned with UK time zone.", "US/foreign hours"),
    ("Must be fluent in Japanese.", "language requirement"),
    ("JLPT N2 holders preferred.", "language requirement"),
    ("Requires 5+ years of experience.", "5+ years experience"),
])
def test_evaluate_drops(make_job, description, reason_start):
    reason, extra = rules.evaluate(make_job(), description)
    assert reason is not None and reason.startswith(reason_start)
    assert extra == {}


# The negation word has to come right before the match: "not a night shift"
# is still dropped.
@pytest.mark.parametrize("description", [
    "No night shift. Day shift only.",
    "Without night shift differential.",
])
def test_negated_night_shift_is_not_dropped(make_job, description):
    reason, _ = rules.evaluate(make_job(), description)
    assert reason is None


# ---- evaluate: flags and skills ---------------------------------------------


def test_skill_scoring(make_job):
    reason, extra = rules.evaluate(make_job(), "We use React, TypeScript and Python. PHP is a plus.")
    assert reason is None
    # React 3 + TypeScript 3 + Python 2
    assert extra["match_score"] == 8
    assert extra["matched_skills"] == "TypeScript, React, Python"
    assert extra["missing_skills"] == "PHP"
    assert "off-stack" not in extra["flags"]  # core skills present


def test_react_native_does_not_count_as_react(make_job):
    _, extra = rules.evaluate(make_job(), "Build apps with React Native.")
    assert extra["matched_skills"] == "React Native"


def test_off_stack_flag_without_core_skills(make_job):
    _, extra = rules.evaluate(make_job(), "Maintain our Laravel and PHP systems.")
    assert "!off-stack (PHP, Laravel)" in extra["flags"]


def test_experience_flag_for_three_to_four_years(make_job):
    reason, extra = rules.evaluate(make_job(), "At least 3 years of experience.")
    assert reason is None
    assert "!3+ yrs exp" in extra["flags"]


def test_training_bond_flag(make_job):
    _, extra = rules.evaluate(make_job(), "A 2-year training bond applies.")
    assert "!training bond" in extra["flags"]


def test_blank_work_arrangement_flag(make_job):
    _, extra = rules.evaluate(make_job(work_arrangements=[]), "")
    assert "!no work arrangement listed" in extra["flags"]


def test_positive_flags(make_job):
    _, extra = rules.evaluate(make_job(), "Fresh graduates welcome! Training is provided.")
    assert "+fresh grads OK" in extra["flags"]
    assert "+will train" in extra["flags"]


def test_previous_employer_flag_comes_from_config(make_job):
    job = make_job(company="Example Software Inc.")
    _, extra = rules.evaluate(job, "")
    assert "!previous employer" not in extra["flags"]

    rules.configure({"previous_employers": ["example software"]})
    _, extra = rules.evaluate(job, "")
    assert "!previous employer" in extra["flags"]


# ---- extraction helpers ----------------------------------------------------


def test_extract_emails_dedups_and_skips_images():
    text = "Send your CV to HR@Example.com or hr@example.com. Logo: banner@2x.png"
    assert rules.extract_emails(text) == ["hr@example.com"]


def test_extract_emails_caps_at_three():
    text = " ".join(f"a{i}@example.com" for i in range(5))
    assert len(rules.extract_emails(text)) == 3


@pytest.mark.parametrize("text, link", [
    ("Apply here: https://forms.gle/abc123 today", "https://forms.gle/abc123"),
    ("Form: https://docs.google.com/forms/d/e/xyz/viewform.", "https://docs.google.com/forms/d/e/xyz/viewform."),
    ("Apply at https://example.com/careers", ""),
])
def test_extract_form_link(text, link):
    assert rules.extract_form_link(text) == link


def test_html_to_text():
    html = "<p>Hello&nbsp;<b>world</b></p><ul><li>React</li><li>C#</li></ul>"
    lines = [line.strip() for line in rules.html_to_text(html).splitlines()]
    assert lines == ["Hello world", "- React", "- C#"]


def test_guess_work_arrangements():
    assert rules.guess_work_arrangements("Hybrid setup, not remote") == ["Hybrid"]
    assert rules.guess_work_arrangements("Work from home, fully remote") == ["Remote"]
