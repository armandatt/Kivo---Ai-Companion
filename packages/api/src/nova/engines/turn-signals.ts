// ─── Turn signals ─────────────────────────────────────────────────────────────
// The one place a turn's signal list is assembled. Pure: no DB, no LLM.
//
//   1. the signal engine proposes candidates from the wording (regex)
//   2. an explicit command establishes its event (protocol)
//   3. the Understanding Brain's reading establishes what the message states:
//      sessionIntent, the dominant intent and any secondary intents (meaning)
//   4. every candidate the Understanding Brain does not corroborate is dropped
//
// What comes out is what every downstream consumer sees.

import type { NovaCommand } from "../commands";
import type { AcademicState } from "../types/academic-state.types";
import type { SignalEngineOutput } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import { extractSignals, withEstablishedSignal } from "./signal-engine";
import { establishedSignals, signalsStatedByUnderstanding } from "./signal-corroboration";

export function resolveTurnSignals(input: {
  text:          string;
  command:       NovaCommand | null | undefined;
  understanding: AcademicUnderstanding;
  state:         AcademicState;
}): SignalEngineOutput {
  const { understanding, command } = input;
  let signals = extractSignals(input.text, input.state);

  if (command === "study") {
    signals = withEstablishedSignal(signals, "session_start", "command");
  } else if (understanding.sessionIntent === "start") {
    signals = withEstablishedSignal(signals, "session_start", "understanding");
  }
  if (command === "done") {
    signals = withEstablishedSignal(signals, "study_report", "command");
  }

  // The dominant intent establishes its event by itself. Secondary intents
  // work through corroboration below: "I finished chapter 3 but I'm
  // exhausted" keeps its study report because the wording matched AND the
  // Understanding Brain listed study_report as a secondary intent.
  // A stated struggle with a named topic. There is no wording pattern for
  // it: it exists only when the Understanding Brain names the topic.
  if (understanding.request?.struggleTopic) {
    signals = withEstablishedSignal(signals, "topic_struggle", "understanding");
  }

  for (const type of signalsStatedByUnderstanding(understanding)) {
    signals = withEstablishedSignal(signals, type, "understanding");
  }

  return establishedSignals(signals, understanding);
}
