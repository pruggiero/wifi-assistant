import OpenAI from 'openai';
import { Message } from './types';

export interface QualifyingFacts {
  /** 'single' - one device affected; 'multiple' - more than one; 'unknown' - not yet established */
  devicesAffected: 'single' | 'multiple' | 'unknown';
  /** User said they only own one device */
  onlyDevice: boolean;
  /** User explicitly named another device and confirmed it is working fine */
  otherDevicesUnaffected: boolean;
  /** One specific app is broken AND user confirmed general internet still works */
  appSpecific: boolean;
  /** 'abnormal' - red/off lights; 'normal' - user said lights look fine; 'unknown' - not mentioned */
  routerLightsStatus: 'abnormal' | 'normal' | 'unknown';
  /** 'yes' - user made recent changes; 'no' - user said no changes; 'unknown' - not discussed */
  recentNetworkChanges: 'yes' | 'no' | 'unknown';
  /** Visible physical damage to the router (cracked, dropped, burnt, flooded) */
  physicalDamage: boolean;
  /** User explicitly mentioned an outage or that someone on a different connection has the same problem */
  ispOutageSuspected: boolean;
  /** Same issue reported at a different physical location or network */
  crossLocationAffected: boolean;
  /** User explicitly said multiple apps/websites are affected - not just one service */
  generalConnectivityConfirmed: boolean;
}

const DEFAULT_FACTS: QualifyingFacts = {
  devicesAffected: 'unknown',
  onlyDevice: false,
  otherDevicesUnaffected: false,
  appSpecific: false,
  routerLightsStatus: 'unknown',
  recentNetworkChanges: 'unknown',
  physicalDamage: false,
  ispOutageSuspected: false,
  crossLocationAffected: false,
  generalConnectivityConfirmed: false,
};

export async function extractQualifyingFacts(
  messages: Message[],
  openai: OpenAI
): Promise<QualifyingFacts> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a fact extractor for a WiFi support system. Extract only what the user has clearly stated. Do not infer or assume.',
      },
      ...messages,
      {
        role: 'user',
        content: `Extract the following facts from this conversation based only on what the user has stated.

devicesAffected: "single" if one device is affected, "multiple" if more than one, "unknown" if not yet established
onlyDevice: true if the user said they only own one device (no other device to compare with)
otherDevicesUnaffected: true ONLY if the user explicitly named at least one other device and said it is working fine (e.g. "my phone is fine", "tablet connects OK", "everything else works") — false if unconfirmed; "just my laptop", "only my laptop", or "it's only affecting my PC" do NOT count — these describe which device has the problem, not that other devices are confirmed working
appSpecific: true ONLY if the message contains TWO things: (1) a specific app or service that is broken, AND (2) an explicit statement that other internet or apps are still working — both must be present; if the user only describes what is broken without also saying what still works, set false; "Netflix isn't working", "WoW keeps disconnecting", "I can't log into a game", "Spotify keeps dropping", "keep disconnecting from FFXIV", "getting disconnected from a game" are all false because they only describe the problem, not what's still working; IMPORTANT: phrases like "keep disconnecting", "keeps disconnecting", "getting disconnected" describe the internet connection dropping — this is a connectivity symptom, NOT evidence that only one app is broken while internet otherwise works — always set false for these
routerLightsStatus: "abnormal" if the user described red lights, lights that are off that are usually on, or other unusual router light behavior (abnormal lights are NOT physical damage); "normal" if the user said lights look normal, look fine, or are the same as usual; "unknown" if router lights have not been mentioned at all
recentNetworkChanges: "yes" if the user mentioned moving the router, adding a device, or changing network settings; "no" if the user said no recent changes or nothing has changed; "unknown" if recent changes have not been discussed at all
physicalDamage: true if the user described visible physical damage to the router (cracked, dropped, burnt, flooded) — do NOT set this for abnormal lights
ispOutageSuspected: true ONLY if the user explicitly mentioned an outage, said their ISP is down, or said a neighbour or someone else on a different connection has the same problem — do NOT set true for intermittent drops, disconnections, or slow speeds alone; "keep disconnecting", "my internet keeps cutting out", or "it drops randomly" are connectivity symptoms, not outage reports; "my internet is out", "my internet is down", "I have no internet", "the internet isn't working" describe the user's own problem — these are NOT outage reports and must not trigger ispOutageSuspected; only set true if the user explicitly used the word "outage" or said something like "my ISP is having issues" or "my neighbour has the same problem"
crossLocationAffected: true if the user mentioned the same issue occurring at a genuinely different physical location or a different network — e.g. a neighbour's house, a friend's place, their office; do NOT set true when multiple people in the same household share a problem (e.g. "me and my wife's computers", "my roommate and I") — that is multiple devices on the same network, not a cross-location issue
generalConnectivityConfirmed: true ONLY if the user explicitly said that MULTIPLE apps, services, or websites are affected — they must have said something like "everything is slow", "all internet is down", "nothing loads", "other apps don't work too", "pages take forever too", "websites are slow as well" — the key is explicit mention of more than one thing being affected; do NOT set true for general complaints like "my internet is slow", "I have no internet", "can't connect", "no internet" alone — those describe a symptom without confirming it affects more than one app or service

Respond with JSON using exactly these field names.`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(
      completion.choices[0].message.content ?? '{}'
    ) as Partial<QualifyingFacts>;
    return { ...DEFAULT_FACTS, ...parsed };
  } catch {
    return DEFAULT_FACTS;
  }
}
