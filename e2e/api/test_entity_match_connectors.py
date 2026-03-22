"""Unit-style checks for litigation connector entity disambiguation (no live HTTP)."""

from rag.connectors.courtlistener import case_matches_entity
from rag.connectors.sec_edgar import sec_filing_entity_matches


def test_courtlistener_rejects_linear_controls_homonym():
    assert not case_matches_entity(
        "Peterson v. Linear Controls, Inc.",
        "Linear",
        "linear.app",
    )
    assert not case_matches_entity("People v. Linear Controls", "Linear", "linear.app")


def test_courtlistener_keeps_versus_captions():
    assert case_matches_entity("Linear v. Acme Corp", "Linear", "linear.app")
    assert case_matches_entity("Acme LLC v. Linear", "Linear", "linear.app")


def test_courtlistener_rejects_short_name_party_without_org_marker():
    """Single very short trade names collide with individuals (e.g. kick.com vs 'State v. Kick')."""
    assert not case_matches_entity("State v. Kick", "Kick", "kick.com")
    assert not case_matches_entity("Anctil v. Kick", "Kick", "kick.com")


def test_courtlistener_keeps_short_name_when_caption_disambiguates():
    assert case_matches_entity("Kick Streaming Inc. v. Acme LLC", "Kick", "kick.com")
    assert case_matches_entity("SEC v. Kick Labs, Inc.", "Kick", "kick.com")


def test_sec_rejects_linear_technology_when_target_is_linear():
    assert not sec_filing_entity_matches("Linear", "Linear Technology Corp")
    assert not sec_filing_entity_matches("Linear", "LINEAR TECHNOLOGIES INC")


def test_sec_allows_normal_corporate_suffixes():
    assert sec_filing_entity_matches("Notion Labs", "Notion Labs Inc.")
    assert sec_filing_entity_matches("Acme", "Acme Corp")


def test_sec_rejects_different_notion():
    assert not sec_filing_entity_matches("Notion Labs", "Notion Accessories Inc")
