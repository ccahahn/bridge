"""Prompt loader.

All prompts live in Braintrust (project: Bridge).
Model-spec files in docs/build/ are reference copies for humans, not used at runtime.
"""

import os
import braintrust

SLUGS = {
    "cash_flow_monitor": "cash-flow-monitor-prompt-49df",
    "credit_assessor": "credit-assessor-prompt-e211",
}


def _init_braintrust():
    """Ensure Braintrust API key is set."""
    try:
        import streamlit as st
        if "BRAINTRUST_API_KEY" in st.secrets:
            os.environ["BRAINTRUST_API_KEY"] = st.secrets["BRAINTRUST_API_KEY"]
    except Exception:
        pass


def get_prompt(agent_name):
    """Get prompt from Braintrust project: Bridge."""
    _init_braintrust()
    slug = SLUGS.get(agent_name, agent_name)
    prompt = braintrust.load_prompt(project="Bridge", slug=slug)
    return prompt.build()["messages"][0]["content"]
