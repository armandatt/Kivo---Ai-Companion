// The one model client, reporting what the learner could read so far
// (reply-stream.ts picks it out of the unfinished reply). Display only.

import { withTextStream } from "../../services/openai.service";
import { liveText } from "./reply-stream";

export function liveGenerate(onLive: (text: string) => void, keys: readonly string[]): ReturnType<typeof withTextStream> {
  let raw = "";
  let shown = "";
  return withTextStream(delta => {
    raw += delta;
    const text = liveText(raw, keys);
    if (text !== shown) { shown = text; onLive(text); }
  });
}
