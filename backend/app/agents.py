"""LangChain-based agent streaming service."""

from collections.abc import AsyncGenerator
import json

from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config import get_settings
from app.prompts import AGENT_SYSTEM_PROMPTS, INTERVIEW_EVALUATOR_SYSTEM


def _build_llm(streaming: bool = True) -> ChatOpenAI:
    """Build clients from runtime settings so providers can be swapped without agent changes."""
    settings = get_settings()
    return ChatOpenAI(
        model=settings.openai_model,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        streaming=streaming,
    )


async def stream_agent_response(
    agent_type: str,
    history: list[dict[str, str]],
    resume_context: str | None = None,
    jd_context: dict[str, object] | None = None,
) -> AsyncGenerator[str, None]:
    """Stream LLM response token-by-token.

    Args:
        agent_type: One of "jd", "resume", "interview".
        history: List of {"role": "user"|"assistant", "content": "..."}.

    Yields:
        Individual text tokens as they arrive.
    """
    system_prompt = AGENT_SYSTEM_PROMPTS.get(agent_type)
    if not system_prompt:
        yield f"未知的 Agent 类型: {agent_type}"
        return

    messages = [SystemMessage(content=system_prompt)]
    if resume_context:
        # Context is a separate SystemMessage so user-authored resume text cannot
        # replace the agent's behavioral instruction. Length caps also bound cost.
        messages.append(
            SystemMessage(
                content=(
                    "补充上下文（用户当前选中的简历内容）：\n"
                    f"{resume_context[:8000]}"
                )
            )
        )
    if jd_context:
        # Reuse validated structured data rather than asking the model to infer the
        # target role again in every resume/interview turn.
        messages.append(
            SystemMessage(
                content=(
                    "补充上下文（用户此前保存的 JD 结构化结果）：\n"
                    f"{json.dumps(jd_context, ensure_ascii=False)}"
                )
            )
        )
    for msg in history:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            from langchain_core.messages import AIMessage

            messages.append(AIMessage(content=msg["content"]))

    llm = _build_llm(streaming=True)

    async for chunk in llm.astream(messages):
        if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str):
            yield chunk.content


async def extract_jd_structured(jd_text: str) -> dict[str, object]:
    """Extract normalized JD JSON, returning a stable empty shape on provider failure."""
    llm = _build_llm(streaming=False)
    messages = [
        SystemMessage(
            content=(
                "你是 JD 结构化抽取器。请把输入 JD 解析为 JSON，且仅输出 JSON。"
                '字段固定为: "skills", "responsibilities", "hard_requirements", "summary"。'
                "skills/responsibilities/hard_requirements 必须是字符串数组，summary 为字符串。"
            )
        ),
        HumanMessage(content=jd_text[:12000]),
    ]
    try:
        resp = await llm.ainvoke(messages)
        content = resp.content if isinstance(resp.content, str) else str(resp.content)
        parsed = json.loads(content)
        return {
            "skills": list(parsed.get("skills", [])),
            "responsibilities": list(parsed.get("responsibilities", [])),
            "hard_requirements": list(parsed.get("hard_requirements", [])),
            "summary": str(parsed.get("summary", "")),
        }
    except Exception:
        # The chat response is still useful when secondary extraction fails. A
        # stable shape lets the frontend render an empty result without branching
        # on provider-specific exceptions or malformed JSON.
        return {
            "skills": [],
            "responsibilities": [],
            "hard_requirements": [],
            "summary": "",
        }


async def extract_interview_feedback(
    *,
    history: list[dict[str, str]],
    resume_context: str | None = None,
    jd_context: dict[str, object] | None = None,
) -> dict[str, object]:
    """Extract interview evaluation JSON from conversation history."""

    def build_transcript(items: list[dict[str, str]]) -> str:
        # Bound each turn and the final transcript to keep evaluation latency and
        # token cost predictable for long-running interviews.
        lines: list[str] = []
        for msg in items:
            role = msg.get("role", "")
            content = msg.get("content", "")
            role_label = "面试官" if role == "assistant" else "候选人"
            lines.append(f"[{role_label}] {content[:2000]}")
        return "\n".join(lines)[:12000]

    llm = _build_llm(streaming=False)
    messages: list[SystemMessage | HumanMessage] = [
        SystemMessage(content=INTERVIEW_EVALUATOR_SYSTEM),
        HumanMessage(content=build_transcript(history)),
    ]

    if resume_context:
        messages.insert(
            1,
            SystemMessage(
                content=(
                    "候选人简历摘要（可用于打分与改进建议）：\n"
                    f"{resume_context[:8000]}"
                )
            ),
        )
    if jd_context:
        messages.insert(
            1,
            SystemMessage(
                content=(
                    "目标 JD 结构化结果（可用于打分与改进建议）：\n"
                    f"{json.dumps(jd_context, ensure_ascii=False)}"
                )
            ),
        )

    fallback: dict[str, object] = {
        "overallScore": 0,
        "overallSummary": "无法生成评价（解析失败）",
        "aspects": [],
        "improvements": [],
    }

    try:
        resp = await llm.ainvoke(messages)
        content = resp.content if isinstance(resp.content, str) else str(resp.content)
        parsed = json.loads(content.strip())

        # Normalize only the contract-critical container fields. The evaluator's
        # human-readable text remains untouched, while malformed arrays cannot
        # crash the end page.
        overall = parsed if isinstance(parsed, dict) else {}
        improvements = overall.get("improvements", [])
        if not isinstance(improvements, list):
            overall["improvements"] = []

        aspects = overall.get("aspects", [])
        if not isinstance(aspects, list):
            overall["aspects"] = []

        overall.setdefault("overallScore", 0)
        overall.setdefault("overallSummary", "")
        return overall
    except Exception:
        # Interview completion must remain navigable even if evaluation fails;
        # persist an explicit zero-score fallback rather than losing the session.
        return fallback
