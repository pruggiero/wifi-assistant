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

**Pre-classification:** Two lightweight classifier calls run before the response is generated. `classifyExit` is a yes/no gate — it fires when guided troubleshooting is not appropriate (e.g. ISP outage, suspected hardware damage). If it does not fire, `classifyIssueType` routes to the matching issue type or returns `continue` to keep qualifying. Both use `response_format: { type: 'json_object' }` and return a typed `decision` field. Pre-classifying first means the LLM instruction always matches the state transition that is about to happen — without this, the response and state can disagree.

**Turn processing:** All per-turn business logic lives in `chatService.processTurn` — classifier calls, transition decisions, instruction selection, and the `stripHistory` flag. The route handles only input validation, sanitization, and the final OpenAI call. `processTurn` returns `{ instruction, nextState, stripHistory }` and is mockable at the service boundary without touching HTTP.

**Step grouping:** Steps are bundled into groups. Non-waiting steps are folded into the next confirmation step, so the user is not prompted after every individual action. The reboot flow has 6 steps across 4 groups.

---

## Design Choices

- **Separate classifier calls:** classifiers are independently testable and swappable without affecting response generation.
- **Server-owned state:** state from the client is validated against the phase enum, registry membership, and step bounds before use. Invalid state resets to the start.
- **Input sanitization:** message `role` is validated against an allowlist, content is capped at 500 characters, and history is limited to 25 messages.
- **Shorter classifier context window:** classifiers receive only the last 8 messages. They need recent intent, not the full history.
- **`gpt-4o-mini` throughout:** handles constrained classification and guided responses well at a fraction of the cost of `gpt-4o`.
- **`temperature: 0` on classifiers, `0.3` on responses:** deterministic classifiers make eval results repeatable. A low non-zero temperature on responses avoids robotic repetition without sacrificing consistency.
- **Structured JSON outputs for classifiers:** classifiers use `response_format: { type: 'json_object' }` and return a typed `decision` field. No logprob parsing, confidence thresholds, or string matching — the JSON schema is the contract. Invalid or missing fields fall back to safe defaults (`continue`, `question`, `pending`, `false`). Each default is safe — re-ask the question, keep qualifying, or skip the exit gate.
- **`processTurn` as a service boundary:** per-turn business logic is isolated from the HTTP layer. Route tests mock `processTurn` to verify HTTP behavior; the service owns all classifier and transition logic.
- **Static response for `closed` phase:** no LLM call once the conversation is done.

---

## Trade-offs

- **Qualifying loop:** without a turn limit, qualifying could run indefinitely. `MAX_QUALIFYING_TURNS = 7` closes gracefully if no issue is identified in time.
- **Backward navigation:** not implemented. The `question` classifier handles the common case - if a user is confused or missed a step, the flow stays on the current step and re-explains. For a physical reboot sequence, going back adds little value.
- **Linear step flow:** steps advance sequentially. If a future flow needs conditional branching (e.g. "combo unit or separate modem and router?"), `StepGroup` would need `branchOutcomes` and a `nextOnOutcome` map, with the step classifier returning a branch label rather than plain `confirm`.
- **Qualifying context not carried into the flow:** `ConversationState` only tracks `issueType` and `stepIndex`. Anything learned during qualifying (device type, symptoms, what the user has already tried) lives in message history but not in state. If steps need to vary based on qualifying answers, the options are a `context` bag on `ConversationState` populated by an extraction step, or separate `IssueType` entries per variant.
- **Registry is compile-time only:** issue types are TypeScript, so adding a new flow requires a code change and redeploy. A config-file or database-backed registry with a schema validator would let non-developers manage flows without touching code.
- **No session persistence:** a server restart resets all conversations. Persisting state would need a session store keyed to the client.
- **No conversationId:** state is echoed back by the client with no session identifier. If two requests for the same conversation arrived concurrently, last-write-wins. Production would need a `conversationId` on each request and either server-side session storage or an optimistic-lock on state writes.
- **No streaming:** responses are a single JSON payload. `nextState` is only known after the full completion, so streaming would require content chunks and `nextState` as separate SSE events — e.g. SSE with a `delta` event per token and a final `state` event.
- **LLM-determined step confirmation:** the step classifier infers whether the user has completed a step from free text. A structured UI (e.g. a "Done" button per step, or a checkbox the user ticks before continuing) would make confirmation explicit and remove a class of misclassification entirely — the LLM determines how to respond, but the UI determines intent. Free-text was kept here to maintain a natural conversation feel and to avoid encoding UI assumptions that may not apply to all issue types. It also surfaces what users are actually confused about — "do I need to unplug the wall socket too?" is diagnostic signal that a button tap would silently discard.
- **Basic error handling:** the route returns a generic 500 for all OpenAI failures. Production would distinguish rate limits, auth failures, and application errors and surface them differently to the client.
- **Full history to response LLM:** the response LLM receives up to 25 messages. A phase-aware window could reduce token cost once the flow moves past qualifying.

---

## Findings

- **Response/state mismatch:** an early version classified after generating the response. Pre-classifying first fixed the case where they disagreed.
- **Single-device routing:** the classifier was routing "only my laptop has no WiFi" to `reboot`. Requiring the user to explicitly name other working devices before choosing `exit` fixed it without breaking the ambiguous case. Two eval cases cover both sides.
- **Mid-step corrections:** "oh wait I made a mistake, let me try again" classifies as `question`, the current step re-prompts, and state does not advance.
- **Classifier safe defaults:** `classifyStepResponse` originally defaulted to `confirm` on a parse error, silently advancing the user to the next step. Every other classifier defaults to the no-op value (`continue`, `pending`, `false`). Changed to `question`, which re-presents the current step — consistent with every other classifier's default.
- **Abort classifier too broad:** "oh wait it's working!" was classified as `abort` without a clear definition of what `abort` covers, leading to a cold exit. `abort` now covers only explicit quits (stop, cancel, nevermind). A separate `resolved` outcome handles the self-healed case and routes to `stepsComplete`.
- **Flow-start step skip:** when the qualifying conversation included "I already unplugged it", the LLM inferred step 1 was already done and started at step 2. Fixed by setting `stripHistory: true` on flow-start — the generation call receives only the instruction, not the qualifying history.
- **Resolution question handler said goodbye:** when the resolution phase handled a follow-up question, the LLM sometimes generated a goodbye despite being told to ask once more if the issue was resolved. State stayed `resolution`, so the next user message re-entered the resolution path and generated another full response. Fixed by adding "Do NOT say goodbye. Do NOT close the conversation." to the question handler instruction.

---

## Eval Tests

Fixed inputs, expected labels, pass/fail, plus an LLM-as-judge step for response quality. Structurally similar to LangSmith, without the UI and dataset versioning. Evals hit the live API and are excluded from `npm test`.

```bash
cd server && npm run test:eval
```

---

## Adding an Issue Type

**Four files to change - nothing else:**

**1. `server/src/stateEngine/types.ts`** - extend the union:
```ts
export type IssueType = 'reboot' | 'newIssue';
```
Mirror the same change in **`client/src/types.ts`**.

**2. `server/src/constants/newIssueSteps.ts`** - define steps using the shared `Step` interface:
```ts
import { Step } from '../stateEngine/types';
export const newIssueSteps: Step[] = [
  { message: 'Instruction shown to the user.', waitForUser: true },
  ...
];
```
Steps with `waitForUser: false` are shown automatically and bundled with the next confirmation step so the user is not prompted after every action.

**3. `server/src/constants/newIssueConfig.ts`** - define the qualifying config and prompts (see `rebootConfig.ts` as a reference):
```ts
import { newIssueSteps } from './newIssueSteps';
import { IssueConfig, buildStepGroups } from '../stateEngine/stepGroups';

export const newIssueConfig: IssueConfig = {
  qualifying: { ... },
  steps: buildStepGroups(newIssueSteps),
  prompts: { ... },
};
```

**4. `server/src/stateEngine/stepGroups.ts`** - add an entry to `issueRegistry`:
```ts
import { newIssueConfig } from '../constants/newIssueConfig';

// in issueRegistry:
newIssue: newIssueConfig,
```

A few things to keep in mind when writing the config for a new entry:

- **`classifierDescription`** - one specific "choose when X" sentence. If the new issue is close to an existing one, sharpen both until the distinction is clear.
- **`routingSignals`** - optional list of conditions that are sufficient to route here even without multi-device confirmation. Each is a short fragment (e.g. `'router shows abnormal lights'`). The classifier renders them as "Also choose X when: ..." lines. Keeps issue-specific routing logic inside the registry rather than hardcoded in the classifier.
- **`exitCriteria`** - write as a fragment (*"only one device is affected..."*); it is joined with other issues' criteria and prefixed automatically. Only needed when there is a meaningful "wrong path" case for this issue type.
- **`suggestedQuestions`** - a pool, not a script — the LLM picks the 1-2 most relevant per turn. Cover enough angles to have something useful at each stage of qualifying.
- **`start`** - runs once when qualifying resolves. Frame it as the solution, not a fresh start — the conversation has already been going.
- **`questionContext`** - short phrase used mid-step when the user asks a clarifying question: *"the user has asked a question while being guided through {questionContext}"*. Keep it natural, e.g. `'a router reboot'` or `'a factory reset'`.
- **`resolution`** - include "This is your final message" and "Do NOT ask follow-up questions" explicitly. Without both, the model tends to close with "Is there anything else I can help you with?" Cover the resolved and unresolved cases separately.

