<h1 align="center">ArcEditor</h1>

</br>

<img class="trimmed-cover" src="assets/arceditor-header.png" alt="ArcEditor Header" width="100%">

<p align="center" style="font-weight: bold">
    Videos should be editable compositions that are configurable via expressions, not flat pixels.
</p>

---

<p align="center">
    Context-aware AI co-pilot/harness built as an Adobe After Effects CEP Extension. (basically just an agentic video editing harness)
    <br/>
    Focused on <strong>local model inference</strong> (via <a href="https://github.com/lemonade-sdk/lemonade">Lemonade</a> or OpenAI-compatible local endpoints), but also works with <a href="https://gemini.google.com/">Gemini</a>, <a href="https://openai.com/">OpenAI</a>, and <a href="https://docs.anthropic.com/">Anthropic</a> cloud providers through API keys.
</p>

---

## Architecture Overview

```mermaid
graph TD
    User([User Prompt]) --> Panel[CEP Frontend Panel / index.html & index.js]
    Panel --> Orchestrator[Agent Loop Orchestrator / js/agent.js]
    Orchestrator --> APIClient[LLM API Client / js/api-client.js]
    APIClient --> LLM{AI Models: Lemonade / Gemini / OpenAI / Anthropic}
    LLM -->|JSON Tool Calls / ExtendScript| Orchestrator
    Orchestrator --> TimelineBridge[Timeline RPC Bridge / js/timeline.js]
    TimelineBridge -->|CSInterface / JSX Execution| Host[After Effects Host Engine]
    Host -->|ExtendScript API: $. _com_arceditor_.ArcEditor| AECOMP[Composition / Timeline]
    AECOMP -->|Active Frame Capture / Base64| TimelineBridge
    TimelineBridge -->|Visual Observations| Orchestrator
```

The extension operates on a closed-loop **ReAct (Reasoning and Action) self-correction cycle**:
1. The **Agent Orchestrator** fetches structural composition context (`getTimelineContext`).
2. The **LLM Client** generates a sequence of actions or high-level ExtendScript code.
3. The **Timeline Bridge** runs the ExtendScript inside After Effects under an isolated transaction namespace (`$._com_arceditor_.ArcEditor`).
4. Visual rendering tools (`captureActiveFrame` or `captureCompositionSequence`) fetch base64 frames back to the agent for visual validation.
5. If syntax or layout runtime errors occur, the orchestrator catches them and automatically triggers self-correction loops.

## Debugging and Development

### Chrome DevTools Remote Debugging
You can inspect the CEP panel UI, console outputs, and memory states using Chrome DevTools:
1. Open a Google Chrome or Microsoft Edge window.
2. Navigate to: `http://localhost:8000`.
3. Select the **ArcEditor** target link to launch the inspector.