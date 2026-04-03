"""Prompt loader.

All prompts live in Braintrust (project: Bridge).
Model-spec files in docs/build/ are reference copies for humans, not used at runtime.
"""

import os
import braintrust


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
    project = braintrust.projects.get("Bridge")
    SLUGS = {
        "cash_flow_monitor": "cash-flow-monitor-prompt-49df",
        "credit_assessor": "credit-assessor-prompt-e211",
    }
    slug = SLUGS.get(agent_name, agent_name)
    prompt = project.prompts.get(slug)
    return prompt.build()["messages"][0]["content"]
