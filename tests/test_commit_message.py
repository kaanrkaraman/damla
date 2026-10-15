import check_commit_message as rules


def test_accepts_conventional_headers() -> None:
    assert rules.problems("feat(extension): add the menu bar switch") == []
    assert rules.problems("fix: stop Python from writing into the app bundle") == []
    assert rules.problems("refactor(helper)!: drop the legacy settings keys") == []


def test_accepts_a_body_after_a_blank_line() -> None:
    assert rules.problems("fix(helper): reject unknown origins\n\nWrites need the extension origin.") == []


def test_rejects_unknown_types_and_missing_scope_syntax() -> None:
    assert rules.problems("Added a thing")
    assert rules.problems("feature: add a thing")
    assert rules.problems("feat(Extension): add a thing")
    assert rules.problems("feat add a thing")


def test_rejects_style_mistakes_in_the_subject() -> None:
    assert rules.problems("feat: Add a thing")
    assert rules.problems("feat: add a thing.")


def test_header_is_capped_at_fifty_characters() -> None:
    assert rules.problems(f"feat: {'x' * 44}") == []
    assert rules.problems(f"feat: {'x' * 45}")


def test_rejects_a_body_without_a_blank_separator() -> None:
    assert rules.problems("feat: add a thing\nbody starts too early")


def test_rejects_ai_attribution_trailers() -> None:
    assert rules.problems("feat: add a thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>")
    assert rules.problems("feat: add a thing\n\nGenerated with Claude Code")


def test_lets_git_generated_messages_through() -> None:
    assert rules.problems("Merge branch 'main' into feature") == []
    assert rules.problems("fixup! feat: add a thing") == []


def test_ignores_comment_lines_from_the_editor() -> None:
    assert rules.problems("feat: add a thing\n# Please enter the commit message") == []
