# WiFi Assistant

An AI-powered chatbot that guides users through diagnosing and resolving WiFi connectivity issues, including a structured router reboot flow based on the Linksys EA6350.

## Setup

```bash
npm run install:all
```

Copy `.env.example` to `.env` and add your OpenAI API key:

```bash
cp .env.example .env
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

Eval tests (classifier + response quality) require an API key in `.env` and can be run separately:

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

State lives entirely on the server. The client echoes `conversationState` back on each request and renders what it gets back.

**Conversation phases:** `qualifying` -> `reboot` -> `resolution` -> `closed`

**Pre-classification pattern:** A cheap classifier call (`max_tokens: 10`) runs before the response is generated. That way the LLM gets an instruction that matches what's about to happen, not what just happened. Without this, the response and the state transition can disagree.

**Reboot step grouping:** The 6 reboot steps are bundled into 4 groups. Steps that don't need user confirmation are folded into the next waiting step, so the user isn't prompted after every individual action.

---

## Design Choices

- **Separate classifier calls over structured outputs / function calling:** keeps classifiers independently testable. Swapping the model or prompt for one classifier doesn't touch response generation.
- **Server-owned state:** the client can't manipulate or replay state out of order. State sent from the client is validated against the known phase enum and a bounds-checked `rebootGroupIndex` before use; invalid state falls back to the start of the conversation.
- **Input sanitization before OpenAI calls:** message `role` is validated against the allowed set, content is capped at 500 characters per message, and the history is limited to 20 messages total. This blocks prompt injection via crafted role values and keeps token usage bounded regardless of client behaviour.
- **Separate context window for classifiers:** classifiers only receive the last 8 messages rather than the full history. They only need recent context to classify intent, so sending the full history would waste tokens on every request.
- **`gpt-4o-mini` throughout:** plenty capable for constrained classifiers and guided responses, and noticeably cheaper than `gpt-4o` for this kind of work.
- **Static response for `closed` phase:** no LLM call at all once the conversation is done.

---

## Challenges and Trade-offs

- **Response/state mismatch:** an early version classified intent *after* generating the response. If they disagreed, the UI said one thing and the state was somewhere else. Pre-classifying first fixed it.
- **Reboot question loop / token cost:** without `abort`, a user who never confirms a step would stay in the `question` branch forever, burning tokens every message. `abort` exits cleanly. Token cost is further controlled by capping message history (20 messages) and using a shorter context window (8 messages) for classifier calls that only need recent intent.
- **Backward navigation:** not implemented here. The `question` classifier covers the common case: if a user is confused or missed something, it stays on the current step and re-explains. A reboot flow also happens to be a case where going back doesn't add much since the steps are physical and sequential. In a different type of guided flow it would be more valuable.
- **State is not persisted:** server restart resets everything. A production version would need a session store or a DB row.

---

## Unique Findings

- **Single-device routing bug:** the qualifying classifier was routing "only my laptop has no WiFi" to `reboot`. The first fix added a rule to exit when only one device is affected, but that introduced a new problem: "just my laptop" (ambiguous) was being treated the same as "just my laptop, phone and tablet are fine" (explicit). The final rule requires the user to explicitly name other working devices before choosing exit. If they say "just my laptop" without mentioning other devices, it stays on `continue` and asks. Two eval cases cover both sides of this distinction.
- **LLM handles mid-reboot corrections naturally:** "oh wait I made a mistake, let me try again" gets classified as `question`, the current step gets re-prompted, and state doesn't advance. No special undo path needed.
- **Resolution phase kept asking follow-up questions:** the LLM would default to "Is there anything else I can help you with?" even after closing. Needed explicit instruction: *"Do NOT ask any follow-up questions. This is your final message."*

---

## Eval Results

The eval tests are modelled after what LangSmith does: run a known input through the real model, assert the output matches the expected label. LangSmith wraps this in a UI with trace logging and dataset versioning; here it's just Vitest fixtures hitting the live API. The pattern is the same: fixed inputs, expected outputs, pass/fail, and a separate LLM-as-judge step for response quality.

Evals are excluded from `npm test` and run separately via `npm run test:eval` so they don't block CI without an API key.
