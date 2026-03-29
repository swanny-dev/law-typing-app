import os
import random
import anthropic
from dotenv import load_dotenv
from content import PUBLIC_LAW_TOPICS, CRIMINAL_LAW_TOPICS, ALL_TOPICS, CASES
from docs import random_chunk, docs_available

load_dotenv()

client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SUBJECT_MAP = {
    "pub":  PUBLIC_LAW_TOPICS,
    "crim": CRIMINAL_LAW_TOPICS,
    "all":  ALL_TOPICS,
}

STYLE_INSTRUCTIONS = {
    "passage": (
        "Write it as a clear, informative legal paragraph explaining the concept. "
        "Use formal academic language appropriate for a law textbook or lecture note."
    ),
    "essay": (
        "Write it in the style of a law essay answer — analytical and argumentative. "
        "Use essay phrases such as 'it is submitted that', 'it is arguable that', "
        "'the court held that', 'it can be contended that', 'on the balance of probabilities', "
        "'the ratio in this case suggests', 'pursuant to', 'notwithstanding'. "
        "Write as if making a legal argument or analysing a legal problem question."
    ),
}


async def generate_exercise(
    length: str = "long",
    subject: str = "pub",
    style: str = "passage",
) -> dict:
    word_count = "20 to 25" if length == "short" else "80 to 100"

    if subject == "cases":
        return await _generate_case_exercise(word_count, style)

    if subject == "docs":
        return await _generate_doc_exercise(word_count, style)

    topics     = SUBJECT_MAP.get(subject, ALL_TOPICS)
    topic      = random.choice(topics)
    style_note = STYLE_INSTRUCTIONS.get(style, STYLE_INSTRUCTIONS["passage"])

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": (
                f"Write a typing exercise for a second-year law student at the "
                f"University of Auckland studying: {topic}.\n\n"
                f"{style_note}\n\n"
                "Additional requirements:\n"
                f"- Exactly one paragraph, {word_count} words\n"
                "- Include relevant NZ statute names and case references where natural\n"
                "- Do not use bullet points, headings, or numbered lists\n"
                "- Return only the paragraph text. No introduction, no title, no quotation marks."
            ),
        }],
    )

    text = response.content[0].text.strip().strip("\"'")
    return {"text": text, "topic": topic}


async def _generate_case_exercise(word_count: str, style: str) -> dict:
    case = random.choice(CASES)

    if style == "essay":
        style_note = (
            "Write it in an analytical essay style, as if discussing the case in a law essay. "
            "Use phrases like 'it is submitted that', 'the ratio suggests', 'it is arguable that', "
            "'the significance of this decision lies in'. Analyse the legal principle critically."
        )
    else:
        style_note = (
            "Write it as a concise, neutral case summary covering: the key facts, "
            "what the court held, and the legal principle or significance established."
        )

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": (
                f"Write a typing exercise summarising the case {case['name']} "
                f"({case['subject']}) for a second-year law student at the University of Auckland.\n\n"
                f"Context: {case['note']}\n\n"
                f"{style_note}\n\n"
                "Additional requirements:\n"
                f"- Exactly one paragraph, {word_count} words\n"
                "- Formal legal language\n"
                "- Do not use bullet points, headings, or numbered lists\n"
                "- Return only the paragraph text. No introduction, no title, no quotation marks."
            ),
        }],
    )

    text = response.content[0].text.strip().strip("\"'")
    return {"text": text, "topic": case["name"]}


async def _generate_doc_exercise(word_count: str, style: str) -> dict:
    doc = random_chunk()
    if not doc:
        # fallback — should not happen if the UI only shows the button when docs exist
        return await generate_exercise(word_count, "all", style)

    style_note = STYLE_INSTRUCTIONS.get(style, STYLE_INSTRUCTIONS["passage"])

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": (
                f"You are helping a law student practise typing using content from their lecture notes.\n\n"
                f"Here is an excerpt from their notes on '{doc['label']}':\n\n"
                f"{doc['chunk']}\n\n"
                f"Using the concepts, terminology, and any cases or statutes mentioned above, "
                f"write a typing exercise for a law student.\n\n"
                f"{style_note}\n\n"
                "Additional requirements:\n"
                f"- Exactly one paragraph, {word_count} words\n"
                "- Reflect the specific content of the excerpt — do not invent unrelated law\n"
                "- Do not use bullet points, headings, or numbered lists\n"
                "- Return only the paragraph text. No introduction, no title, no quotation marks."
            ),
        }],
    )

    text = response.content[0].text.strip().strip("\"'")
    return {"text": text, "topic": doc["label"]}


async def generate_counsel_exercise(keys: list[str]) -> dict:
    """Generate a targeted exercise heavy with words containing the given error keys."""
    key_list = ", ".join(f"'{k}'" for k in keys)
    # Build bigram context: pairs of adjacent keys are harder to type quickly
    bigrams = [f"{keys[i]}{keys[i+1]}" for i in range(len(keys) - 1)]
    bigram_note = (
        f"Pay particular attention to key pairs (bigrams) such as: {', '.join(bigrams[:4])}. "
        if bigrams else ""
    )

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": (
                f"Write a typing exercise for a law student that is specifically designed to "
                f"improve accuracy on these frequently mistyped keys: {key_list}.\n\n"
                f"{bigram_note}"
                f"The passage must:\n"
                f"- Be a single paragraph of 60 to 80 words\n"
                f"- Be written in formal legal language (law essay or textbook style)\n"
                f"- Heavily feature words that contain the specified keys — these characters "
                f"should appear far more frequently than in a typical passage\n"
                f"- Include NZ statute names or case references where natural\n"
                f"- Do not use bullet points, headings, or numbered lists\n"
                f"- Return only the paragraph text. No introduction, no title, no quotation marks."
            ),
        }],
    )

    text = response.content[0].text.strip().strip("\"'")
    return {"text": text, "topic": "mistake counsel"}


__all__ = ["generate_exercise", "generate_counsel_exercise", "docs_available"]
