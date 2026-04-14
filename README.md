# WiFi Assistant

A chat interface for diagnosing WiFi connectivity issues and walking users through structured troubleshooting steps. Currently covers router reboot (Linksys EA6350).

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

Eval tests require an API key and run separately:

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

State is server-owned. The client sends `conversationState` back with each request and renders what it receives.

**Phases:** `qualifying` -> `guided-steps` -> `resolution` -> `closed`

**Issue registry:** Issue types are defined in `issueRegistry` in `stepGroups.ts`. Each entry owns its qualifying config, step groups, and prompts. The classifier, qualifying prompt, routing, and resolution look-up all read from the registry. See [Adding an Issue Type](#adding-an-issue-type).

**Pre-classification:** A lightweight classifier call (`max_tokens: 10`) runs before the response is generated, so the LLM instruction matches the transition that is about to happen. Without this, the response and state can disagree.

**Step grouping:** Steps are bundled into groups. Non-waiting steps are folded into the next confirmation step, so the user is not prompted after every individual action. The reboot flow has 6 steps across 4 groups.

---

## Design Choices

- **Separate classifier calls:** classifiers are independently testable and swappable without affecting response generation.
- **Server-owned state:** state from the client is validated against the phase enum, registry membership, and step bounds before use. Invalid state resets to the start.
- **Input sanitization:** message `role` is validated against an allowlist, content is capped at 500 characters, and history is limited to 25 messages.
- **Shorter classifier context window:** classifiers receive only the last 8 messages. They need recent intent, not the full history.
- **`gpt-4o-mini` throughout:** handles constrained classification and guided responses well at a fraction of the cost of `gpt-4o`.
- **`temperature: 0` on classifiers, `0.3` on responses:** deterministic classifiers make eval results repeatable. A low non-zero temperature on responses avoids robotic repetition without sacrificing consistency.
- **Logprob confidence check:** both classifiers reject responses where `Math.exp(logprob) < 0.4`. With 3 classes, random chance is 33%, so anything below 40% is unreliable. The conversation closes with a rephrase prompt rather than acting on a weak classification.
- **Static response for `closed` phase:** no LLM call once the conversation is done.

---

## Trade-offs

- **Response/state mismatch:** an early version classified after generating the response. Pre-classifying first fixed the case where they disagreed.
- **Qualifying loop:** without a turn limit, qualifying could run indefinitely. `MAX_QUALIFYING_TURNS = 5` closes gracefully if no issue is identified in time.
- **Backward navigation:** not implemented. The `question` classifier handles the common case - if a user is confused or missed a step, the flow stays on the current step and re-explains. For a physical reboot sequence, going back adds little value.
- **Linear step flow:** steps advance sequentially. If a future flow needs conditional branching (e.g. "combo unit or separate modem and router?"), `StepGroup` would need `branchOutcomes` and a `nextOnOutcome` map, with the step classifier returning a branch label rather than plain `confirm`.
- **Qualifying context not carried into the flow:** `ConversationState` only tracks `issueType` and `stepIndex`. Anything learned during qualifying (device type, symptoms, what the user has already tried) lives in message history but not in state. If steps need to vary based on qualifying answers, the options are a `context` bag on `ConversationState` populated by an extraction step, or separate `IssueType` entries per variant.
- **Registry is compile-time only:** issue types are TypeScript, so adding a new flow requires a code change and redeploy. A config-file or database-backed registry with a schema validator would let non-developers manage flows without touching code.
- **No session persistence:** a server restart resets all conversations. Persisting state would need a session store keyed to the client.
- **No streaming:** responses are a single JSON payload. `nextState` is only known after the full completion, so streaming would require content chunks and `nextState` as separate SSE events.
- **Full history to response LLM:** classifiers use 8 messages, but the response LLM gets up to 25. A phase-aware window could reduce token cost once the flow moves past qualifying.

---

## Findings

- **Single-device routing:** the classifier was routing "only my laptop has no WiFi" to `reboot`. Requiring the user to explicitly name other working devices before choosing `exit` fixed it without breaking the ambiguous case. Two eval cases cover both sides.
- **Mid-step corrections:** "oh wait I made a mistake, let me try again" classifies as `question`, the current step re-prompts, and state does not advance. No special handling needed.
- **Resolution follow-up questions:** without explicit instruction the model defaults to "Is there anything else I can help you with?" Adding "This is your final message. Do NOT ask follow-up questions." to the resolution prompt stopped it.

---

## Eval Tests

Fixed inputs, expected labels, pass/fail, plus an LLM-as-judge step for response quality. Structurally similar to LangSmith, without the UI and dataset versioning. Evals hit the live API and are excluded from `npm test`.

```bash
cd server && npm run test:eval
```

---

## Adding an Issue Type

**Three files to change - nothing else:**

**1. `server/src/stateEngine/types.ts`** - extend the union:
```ts
export type IssueType = 'reboot' | 'newIssue';
```
Mirror the same change in **`client/src/types.ts`**.

**2. `server/src/constants/newIssueSteps.ts`** - define steps using the shared `Step` interface:
```ts
import { Step } from '../stateEngine/types';
export const newIssueSteps: Step[] = [
  { id: 1, message: 'Instruction shown to the user.', waitForUser: true },
  ...
];
```
Steps with `waitForUser: false` are shown automatically and bundled with the next confirmation step so the user is not prompted after every action.

**3. `server/src/stateEngine/stepGroups.ts`** - add an entry to `issueRegistry`:
```ts
import { newIssueSteps } from '../constants/newIssueSteps';

// in issueRegistry:
newIssue: {
  qualifying: {
    classifierDescription: 'One sentence: when should the classifier choose this issue type over others.',
    exitCriteria: 'Fragment describing when guided steps won\'t help, e.g. "only one device is affected, ..."',
    suggestedQuestions: [
      'A diagnostic question relevant to this issue type.',
      'Another question covering a different angle.',
    ],
  },
  steps: buildStepGroups(newIssueSteps),
  prompts: {
    start: 'Qualifying is done and this flow is the right next step. Tell the user what you are about to do and ask them to confirm before you begin.',
    questionContext: 'short phrase for mid-step context, e.g. "a router reboot"',
    abort: 'The user wants to stop. Acknowledge warmly and close.',
    stepsComplete: 'All steps are done. Ask the user if their issue is resolved.',
    resolution: 'This is your final message. [Describe the outcome]. If resolved: congratulate and close. If not: apologize and suggest contacting their ISP or a technician. Do NOT ask follow-up questions.',
  },
},
```

A few things to keep in mind when writing the prompts for a new entry:

- **`classifierDescription`** - one specific "when to choose this" sentence. The model picks between labels, so ambiguity between two similar descriptions causes misroutes. If your new issue is conceptually close to an existing one, sharpen both descriptions until the distinction is clear.
- **`exitCriteria`** - write as a fragment (*"only one device is affected..."*); it is joined with other issues' criteria and prefixed automatically. Only needed when there is a meaningful "wrong path" case for this issue type.
- **`suggestedQuestions`** - a pool, not a script. The LLM picks the 1-2 most relevant per turn. Cover different angles so it has something useful to ask at each stage of the diagnostic.
- **`start`** - runs once when qualifying resolves. Be explicit that the LLM should confirm the user is ready before presenting any steps - without it the model often skips straight to step 1.
- **`questionContext`** - short phrase used mid-step when the user asks a clarifying question: *"the user has asked a question while being guided through {questionContext}"*. Keep it natural, e.g. `'a router reboot'` or `'a factory reset'`.
- **`resolution`** - include "This is your final message" and "Do NOT ask follow-up questions" explicitly. Without both, the model tends to close with "Is there anything else I can help you with?" Cover the resolved and unresolved cases separately.

