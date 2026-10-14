"""Deck metadata, stored as JSON inside index.html."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

FORMAT = "opendeck/1"
DEFAULT_WIDTH, DEFAULT_HEIGHT = 1024, 576


@dataclass
class DeckMeta:
    title: str = "Untitled"
    width: int = DEFAULT_WIDTH
    height: int = DEFAULT_HEIGHT
    margin: float = 0.0
    theme_font: str = "montserrat"
    theme_color: str = "white-blue"
    transition: str = "fade"
    background_transition: str = "fade"
    slide_number: bool = True
    notes: dict[str, str] = field(default_factory=dict)
    macros: dict[str, str] = field(default_factory=dict)
    source: dict = field(default_factory=dict)
    format: str = FORMAT

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "DeckMeta":
        if data.get("format") != FORMAT:
            raise ValueError(f"unsupported deck format {data.get('format')!r}; expected {FORMAT!r}")
        known = cls.__dataclass_fields__
        return cls(**{k: v for k, v in data.items() if k in known})

    @classmethod
    def from_slconfig(cls, sl: dict, title: str = "") -> "DeckMeta":
        """Map a slides.com SLConfig onto our metadata. The original is kept under source."""
        deck = sl.get("deck", {})
        return cls(
            title=deck.get("title") or title or "Untitled",
            width=int(deck.get("width") or DEFAULT_WIDTH),
            height=int(deck.get("height") or DEFAULT_HEIGHT),
            margin=float(deck.get("margin") or 0.0),
            theme_font=deck.get("theme_font") or "montserrat",
            theme_color=deck.get("theme_color") or "white-blue",
            transition=deck.get("transition") or "fade",
            background_transition=deck.get("background_transition") or "fade",
            slide_number=bool(deck.get("slide_number", True)),
            notes={str(k): v for k, v in (deck.get("notes") or {}).items()},
            source={"kind": "slides.com", "slug": deck.get("slug"), "id": deck.get("id"),
                    "version": deck.get("version"), "slconfig": sl},
        )
