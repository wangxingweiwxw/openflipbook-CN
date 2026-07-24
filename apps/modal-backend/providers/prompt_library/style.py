"""Medium-lock and anti-garble guard fragments — the style invariants.

The medium guard is the load-bearing line against photoreal/3D-render drift
(worst on "isometric"-register prompts and on Kontext, which takes no style
ref image — the text IS its style channel). The lettering guard stops models
baiting themselves into rendering captions as garble. One canonical source;
composers append these rather than re-typing them.
"""
from __future__ import annotations

MEDIUM_GUARD = "NOT a photograph, no photorealism"
LETTERING_GUARD = "Keep any lettering sparse and legible — no garbled text."
# DOM-labels mode (suppress_map_labels): the image carries NO baked text at
# all — names live in a client overlay built from entity data. Fixes both the
# garbled-lettering problem and clicks landing on text instead of places.
NO_LETTERING = (
    "Do not write ANY names, lettering, text, or cartouches into the image — "
    "the interface overlays names separately."
)

# Prepended (not a style_anchor override) when EXPLAINER_CARTOON_STYLE=1.
# Lands at the very front of the composed image prompt; planner output and
# any `Style: …` lock stay intact after it.
CARTOON_HANDDRAWN_PREAMBLE = (
    "儿童绘本风格：白底，柔和暖色，搭配简单 shapes；天真、充满奇思妙想的故事插画。俏皮且甜美。"
)


def maybe_prepend_cartoon_style(prompt: str) -> str:
    """If ``EXPLAINER_CARTOON_STYLE`` is on, put the cartoon brief in front of
    ``prompt`` without replacing it. Flag default off → byte-identical."""
    from _env import env_flag

    if not env_flag("EXPLAINER_CARTOON_STYLE"):
        return prompt
    body = (prompt or "").strip()
    if not body:
        return CARTOON_HANDDRAWN_PREAMBLE
    return f"{CARTOON_HANDDRAWN_PREAMBLE}\n\n{body}"


def medium_lock(style_anchor: str | None, *, ref_name: str = "the reference") -> str:
    """The keep-this-exact-medium sentence, with or without a named anchor.

    Mirrors the phrasing build_enter_instruction shipped with (and the enter
    eval validated at 9.33/10 medium-faithfulness): name the anchor when the
    session has one, otherwise lean on the reference image's medium. The
    default ref_name keeps the legacy string byte-identical; view-aware
    instructions pass "Image 2" when the style exemplar is a named ref."""
    text = f"Keep the exact art medium of {ref_name}"
    if style_anchor and style_anchor.strip():
        text += f" — {style_anchor.strip()} —"
    text += f" same palette and line work; {MEDIUM_GUARD}. {LETTERING_GUARD}"
    return text
