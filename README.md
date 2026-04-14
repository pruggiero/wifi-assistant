# WiFi Assistant

An AI-powered chatbot that diagnoses WiFi issues and walks users through a structured router reboot flow based on the Linksys EA6350.

## Setup

```bash
npm run install:all
cp .env.example .env   # add your OpenAI API key
```

## Running

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001

## Testing

```bash
npm test
```

Eval tests require an API key and run separately so they don't block CI:

```bash
cd server && npm run test:eval
```

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express, TypeScript
- **AI:** OpenAI API (`gpt-4o-mini`)
- **Testing:** Vitest, React Testing Library, Supertest

---

## Architecture

State lives entirely on the server. The client echoes `conversationState` back on each request and renders what it receives.

**Conversation phases:** `qualifying` -> `guided-steps` -> `resolution` -> `closed`

**Issue registry:** Issue types (currently `reboot`) are defined in `issueRegistry`, each owning its step groups and prompt strings. Adding a new issue type means adding one entry there; the rest of the flow picks it up automatically.

**Pre-classification:** A cheap classifier call (`max_tokens: 10`) runs before the response is generated, so the LLM gets an instruction matching what is about to happen rather than what just happened. Without this, the response and the state transition can disagree.

**Step grouping:** The 6 reboot steps are bundled into 4 groups. Steps that don't need user confirmation are folded into the next waiting step, so the user isn't prompted after every individual action.

---

## Design Choices

- **Separate classifier calls:** keeps classifiers independently testable. Swapping the model or prompt for one classifier doesn't affect response generation.
- **Server-owned state:** the client can't manipulate or replay state out of order. State from the client is validated against the phase enum, registry membership, and step bounds before use; invalid state falls back to the start of the conversation.
- **Input sanitization:** message `role` is validated against the allowed set, content is capped at 500 characters, and history is limited to 25 messages. This blocks prompt injection via crafted role values and keeps token usage bounded.
- **Shorter classifier context window:** classifiers receive only the last 8 messages. They only need recent intent, so sending the full history wastes tokens on every request.
- **`gpt-4o-mini` throughout:** capable for constrained classifiers and guided responses, and noticeably cheaper than `gpt-4o` for this workload.
- **`temperature: 0` on classifiers, `0.3` on responses:** classifiers need to be deterministic so eval results are meaningful. A low non-zero temperature on responses keeps phrasing consistent while avoiding robotic repetition.
- **Logprob confidence check:** both classifiers use `logprobs: true` and treat `Math.exp(logprob) < 0.4` as low confidence. With 3 classes, random chance is 33%, so anything below 40% signals the model can barely distinguish labels. The conversation closes with a rephrase prompt rather than acting on an unreliable classification.
- **Static response for `closed` phase:** no LLM call once the conversation is done.

---

## Challenges and Trade-offs

- **Response/state mismatch:** an early version classified intent after generating the response. If they disagreed, the UI said one thing while the state was somewhere else. Pre-classifying first fixed it.
- **Infinite question loop:** without `abort`, a user who never confirms a step would stay in the `question` branch indefinitely. `abort` exits cleanly. Token cost is further controlled by capping history (25 messages) and using a shorter classifier window (8 messages).
- **Backward navigation:** not implemented. The `question` classifier covers the common case: if a user is confused or missed a step, it stays on the current step and re-explains. A physical reboot sequence is also a case where going back adds little value.
- **State is not persisted:** a server restart resets everything. A production version would need a session store or a database row.
- **No streaming:** responses are returned as a single JSON payload. Streaming would improve perceived responsiveness, but `nextState` is only known after the full completion arrives, so a streaming version would need to deliver content chunks and `nextState` as separate SSE events.
- **Full history sent to response LLM:** classifiers use a shorter window (8 messages), but the response LLM receives the full history (up to 25). In `qualifying` that context matters. In `guided-steps` and `resolution`, the instruction already encodes what to say next, so a phase-aware window could reduce token cost on longer conversations.

---

## Findings

- **Single-device routing bug:** the qualifying classifier was routing "only my laptop has no WiFi" to `reboot`. The first fix exited when only one device was affected, but that made "just my laptop" (ambiguous) behave the same as "just my laptop, phone and tablet are fine" (explicit). The final rule requires the user to explicitly name other working devices before choosing exit. Two eval cases cover both sides of this.
- **Mid-step corrections work without special handling:** "oh wait I made a mistake, let me try again" gets classified as `question`, the current step gets re-prompted, and state doesn't advance.
- **Resolution phase kept asking follow-up questions:** the LLM would default to "Is there anything else I can help you with?" without explicit instruction to stop. Fixed by adding "Do NOT ask any follow-up questions. This is your final message." to the resolution prompt.

---

## Eval Tests

Modelled after LangSmith: fixed inputs, expected labels, pass/fail, plus an LLM-as-judge step for response quality. LangSmith adds a UI with trace logging and dataset versioning; here it's Vitest fixtures hitting the live API directly.

Evals are excluded from `npm test` and run separately via `npm run test:eval`.
