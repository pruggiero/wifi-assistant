# WiFi Assistant

Chat-based WiFi troubleshooter. Currently covers router reboot (Linksys EA6350).

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

**Pre-classification:** Each qualifying turn starts with `extractQualifyingFacts` - one LLM call that pulls structured facts from what the user has said: device count, whether the failure is app-specific, router lights, recent changes, physical damage, ISP outage, and so on. `routerLightsStatus` and `recentNetworkChanges` are three-state (`'abnormal'|'normal'|'unknown'` and `'yes'|'no'|'unknown'`) because 'not mentioned yet' is different from 'explicitly no'. The LLM only extracts - no reasoning. A `route(facts)` function in the issue config does the actual routing in TypeScript. During guided steps, `classifyStepResponse` returns a typed label (`confirm | question | abort | resolved`); `classifyResolution` returns `resolved | partial | unresolved | pending | question`. Both use `response_format: { type: 'json_object' }`. Pre-classifying first means the LLM instruction always matches the state transition that is about to happen - without this, the response and state can disagree.

**Turn processing:** All per-turn business logic lives in `chatService.processTurn` - classifier calls, transition decisions, instruction selection, and the `stripHistory` flag. The route handles only input validation, sanitization, and the final OpenAI call. `processTurn` returns `{ instruction, nextState, stripHistory }` and is mockable at the service boundary without touching HTTP.

**Step grouping:** Steps are bundled into groups. Non-waiting steps are folded into the next confirmation step, so the user is not prompted after every individual action. The reboot flow has 6 steps across 4 groups.

---

## Design Choices

- **Facts extraction + code routing:** the LLM extracts structured facts (device count, lights, damage, etc.); a `route` function in the issue config applies deterministic logic. Routing rules are plain TypeScript - readable, testable, and changed without touching a prompt. The LLM only answers factual questions it cannot get wrong.
- **Per-outcome resolution prompts:** `classifyResolution` returns a typed label (`resolved | partial | unresolved`); `processResolution` indexes directly into `config.prompts.resolution[decision]`. The LLM receives a single, unconditional instruction rather than a multi-branch blob it must re-interpret. The same principle applies to `stepsComplete` - it only fires when the step classifier returns `resolved`, so the prompt is unconditional.
- **Server-owned state:** state from the client is validated against the phase enum, registry membership, and step bounds before use. Invalid state resets to the start.
- **Input sanitization:** message `role` is validated against an allowlist, content is capped at 500 characters, and history is limited to 25 messages.
- **Shorter classifier context window:** classifiers receive only the last 8 messages. They need recent intent, not the full history.
- **`gpt-4o-mini` throughout:** good enough for constrained classification and short guided responses, and much cheaper than `gpt-4o`.
- **`temperature: 0` on classifiers, `0.3` on responses:** deterministic classifiers make eval results repeatable. A low non-zero temperature on responses avoids robotic repetition without sacrificing consistency.
- **Structured JSON outputs for classifiers:** classifiers use `response_format: { type: 'json_object' }` and return a typed `decision` field. No logprob parsing, confidence thresholds, or string matching - the JSON schema is the contract. Invalid or missing fields fall back to safe defaults (`continue`, `question`, `pending`, `false`). Each default is safe - re-ask the question, keep qualifying, or skip the exit gate.
- **`processTurn` as a service boundary:** per-turn business logic is isolated from the HTTP layer. Route tests mock `processTurn` to verify HTTP behavior; the service owns all classifier and transition logic.
- **Static response for `closed` phase:** no LLM call once the conversation is done.

---

## Trade-offs

- **Qualifying loop:** without a turn limit, qualifying could run indefinitely. `MAX_QUALIFYING_TURNS = 7` closes gracefully if no issue is identified in time.
- **Backward navigation:** not implemented. The `question` classifier handles the common case - if a user is confused or missed a step, the flow stays on the current step and re-explains. For a physical reboot sequence, going back adds little value.
- **Linear step flow:** steps advance sequentially. If a future flow needs conditional branching (e.g. "combo unit or separate modem and router?"), `StepGroup` would need `branchOutcomes` and a `nextOnOutcome` map, with the step classifier returning a branch label rather than plain `confirm`.
- **Qualifying context not carried into the flow:** `ConversationState` only tracks `issueType` and `stepIndex`. Anything learned during qualifying (device type, symptoms, what the user has already tried) lives in message history but not in state. If steps need to vary based on qualifying answers, the options are a `context` bag on `ConversationState` populated by an extraction step, or separate `IssueType` entries per variant.
- **Registry is compile-time only:** adding a flow requires a code change and redeploy. A config-file or database-backed registry would let non-developers manage flows without touching code.
- **No session persistence:** a server restart resets all conversations. Persisting state would need a session store keyed to the client.
- **No conversationId:** state is echoed back by the client with no session identifier. If two requests for the same conversation arrived concurrently, last-write-wins. Production would need a `conversationId` on each request and either server-side session storage or an optimistic-lock on state writes.
- **No streaming:** responses are a single JSON payload. `nextState` is only known after the full completion, so streaming would require content chunks and `nextState` as separate SSE events - e.g. SSE with a `delta` event per token and a final `state` event.
- **LLM-determined step confirmation:** the step classifier infers from free text whether the user has completed a step. A 'Done' button would remove a whole class of misclassification. Free text was kept because conversation feel matters, and because questions mid-step ("do I need to unplug the wall socket too?") are diagnostic signal - a button tap would discard that.
- **Basic error handling:** the route returns a generic 500 for all OpenAI failures. Production would distinguish rate limits, auth failures, and application errors and surface them differently to the client.
- **Full history to response LLM:** the response LLM receives up to 25 messages. A phase-aware window could reduce token cost once the flow moves past qualifying.

---

## Findings

- **Response/state mismatch:** an early version classified after generating the response. Pre-classifying first fixed the case where they disagreed.
- **Single-device routing (two bugs):** `'just my laptop has no internet'` was routing to `exit` immediately - before asking about router lights or recent changes. `routerLightsAbnormal` and `recentNetworkChanges` were `boolean`, making 'not asked yet' and 'explicitly no' the same value. Both are now three-state. The single-device branch returns `continue` until both signals have been explicitly established. `otherDevicesUnaffected` still triggers an immediate `exit` when the user names other working devices.
- **Mid-step corrections:** "oh wait I made a mistake, let me try again" classifies as `question`, the current step re-prompts, and state does not advance.
- **Classifier safe defaults:** `classifyStepResponse` originally defaulted to `confirm` on a parse error, silently advancing the user to the next step. Every other classifier defaults to the no-op value (`continue`, `pending`, `false`). Changed to `question`, which re-presents the current step - consistent with every other classifier's default.
- **Abort classifier too broad:** "oh wait it's working!" was classified as `abort` without a clear definition of what `abort` covers, leading to a cold exit. `abort` now covers only explicit quits (stop, cancel, nevermind). A separate `resolved` outcome handles the self-healed case and routes to `stepsComplete`.
- **Flow-start step skip:** when the qualifying conversation included "I already unplugged it", the LLM inferred step 1 was already done and started at step 2. Fixed by setting `stripHistory: true` on flow-start - the generation call receives only the instruction, not the qualifying history.
- **App-specific ambiguity:** `'Netflix isn't working'`, `'WoW won't let me log in'`, and `'keep disconnecting from WoW'` were all classified as `appSpecific: true` or triggering `ispOutageSuspected`, exiting before asking a single question. Any named service can get caught this way - login errors could be auth, disconnections could be WiFi instability or a game server blip. The extraction prompt now requires explicit contrast ("everything else works, only X is broken") before `appSpecific` fires, and requires an explicit outage mention before `ispOutageSuspected` fires - intermittent drops alone don't count.
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

Notes on writing the config:

- **`route(facts)`** - a pure function that receives a `QualifyingFacts` object and returns the issue type, `'exit'`, or `'continue'`. All routing logic lives here - no prose, no prompt-tuning. Check `rebootConfig.ts` for a worked example.
- **`suggestedQuestions`** - a pool, not a script - the LLM picks the 1-2 most relevant per turn. Cover enough angles to have something useful at each stage of qualifying. These also drive the qualifying prompt, so keep them specific.
- **`start`** - runs once when qualifying resolves. Frame it as the solution, not a fresh start - the conversation has already been going.
- **`questionContext`** - short phrase used mid-step when the user asks a clarifying question: *"the user has asked a question while being guided through {questionContext}"*. Keep it natural, e.g. `'a router reboot'` or `'a factory reset'`.
- **`resolution`** - three separate strings keyed by outcome: `resolved`, `partial`, `unresolved`. Each is unconditional - `processResolution` selects the right one, so the LLM receives a single instruction with no branching. Include "This is your final message" and "Do NOT ask follow-up questions" explicitly in each. Without both, the model tends to close with "Is there anything else I can help you with?"
- **`stepsComplete`** - used only when the user self-resolves during guided steps. Always a success case - keep it unconditional (no "if resolved... if not resolved..." branches).

