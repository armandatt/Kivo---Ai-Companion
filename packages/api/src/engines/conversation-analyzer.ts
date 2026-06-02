import type {
  ConversationAnalysis,
  MessageIntent,
  Domain,
  EmotionType,
  ConstraintType,
  CommitmentLevel,
  RequestedOutcome,
  DetectedGoal,
  DetectedConstraint,
  EmotionResult,
} from '../types/mentor.types';

export interface ConversationContext {
  recentMessages: Array<{ role: 'user' | 'assistant'; text: string }>;
  userDomain: Domain | null;
  previousIntents: MessageIntent[];
}

const EMPTY_CONTEXT: ConversationContext = {
  recentMessages: [],
  userDomain: null,
  previousIntents: [],
};

export function analyzeConversation(
  rawText: string,
  context: ConversationContext = EMPTY_CONTEXT
): ConversationAnalysis {
  const normalized = normalizeText(rawText);
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;

  const intent = detectPrimaryIntent(normalized, context);
  const secondaryIntents = detectSecondaryIntents(normalized, context, intent);
  const goal = extractGoal(normalized);
  const domain = goal?.domain ?? classifyDomain(normalized, context);
  const emotion = analyzeEmotion(normalized, rawText, wordCount);
  const constraints = extractConstraints(normalized);
  const { commitmentLevel, commitmentScore } = analyzeCommitment(normalized);
  const urgency = calculateUrgency(normalized, constraints, intent);
  const requestedOutcome = detectRequestedOutcome(normalized, intent);
  const confidence = calculateConfidence(normalized, intent, goal, emotion, wordCount);

  return {
    intent,
    secondaryIntents,
    goal,
    domain,
    emotion,
    constraints,
    commitmentLevel,
    commitmentScore,
    urgency,
    requestedOutcome,
    hasFailureReport: detectFailureReport(normalized),
    hasExcuse: detectExcuse(normalized),
    hasCommitment: commitmentScore >= 0.5,
    isQuestion: detectIsQuestion(rawText, normalized),
    isRepeat: detectIsRepeat(normalized, context),
    wordCount,
    confidence,
    rawText,
    normalizedText: normalized,
    entities: undefined,
  };
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Intent detection ──────────────────────────────────────────────────────────

type IntentScores = Record<MessageIntent, number>;

const INTENT_SIGNALS: Record<MessageIntent, Array<{ pattern: RegExp; weight: number }>> = {
  goal_set: [
    { pattern: /\b(want to|wanna|trying to|planning to|i need to|my goal is|i aim to|goal is to|looking to|hoping to)\b/, weight: 2 },
    { pattern: /\b(start|begin|launch|kick off)\b.{0,30}\b(routine|habit|journey|plan|goal)\b/, weight: 2 },
    { pattern: /\b(i have a goal|set a goal|new goal)\b/, weight: 1.5 },
    { pattern: /\b(improve|get better|work on|focus on|build)\b.{0,40}\b(myself|my|this)\b/, weight: 1 },
  ],
  plan_request: [
    { pattern: /\b(make me a plan|create a plan|plan for|plan my|help me plan|give me a schedule|design a|build me a|what'?s? my plan)\b/, weight: 3 },
    { pattern: /\b(how should i|how do i|what should i do|where do i start)\b/, weight: 2 },
    { pattern: /\b(roadmap|schedule|breakdown|structure|approach|steps?|path)\b/, weight: 1.5 },
    { pattern: /\bplan\b/, weight: 1 },
  ],
  status_update: [
    { pattern: /\b(i (did|completed|finished|done|started|worked on|trained|studied)|here'?s? (my|the) update)\b/, weight: 2 },
    { pattern: /\b(today i|this week i|yesterday i|just (did|finished|completed))\b/, weight: 2 },
    { pattern: /\b(letting you know|checking in|reporting|update (on|for))\b/, weight: 1.5 },
  ],
  failure_report: [
    { pattern: /\b(didn'?t|did not|couldn'?t|could not|failed to|missed|skipped|wasn'?t able)\b/, weight: 2 },
    { pattern: /\b(fell off|lost track|gave up|quit|stopped|haven'?t been)\b/, weight: 2 },
    { pattern: /\b(i messed up|screwed up|blew it|dropped the ball)\b/, weight: 2.5 },
  ],
  excuse: [
    { pattern: /\b(because|due to|since|i had to|was busy|got (busy|distracted|caught up)|something came up)\b/, weight: 1.5 },
    { pattern: /\b(i (couldn'?t help|couldn'?t avoid|can'?t control)|not my fault|it'?s? the situation)\b/, weight: 2 },
    { pattern: /\b(if only|i would have but|it'?s? complicated)\b/, weight: 1.5 },
  ],
  commitment_made: [
    { pattern: /\b(i (will|am going to|commit|promise|swear|guarantee)|from (now on|today|tomorrow)|starting (today|now|tomorrow))\b/, weight: 2 },
    { pattern: /\b(no (more|excuses)|this time|for real|seriously this time|i mean it)\b/, weight: 2 },
    { pattern: /\b(i'?ll|i will|gonna)\b.{0,30}\b(do|start|finish|complete|make)\b/, weight: 1.5 },
  ],
  reflection: [
    { pattern: /\b(thinking about|reflecting on|realized?|noticed|looking back|in hindsight|wondering)\b/, weight: 2 },
    { pattern: /\b(why (do|did|am|don'?t) i|i keep (doing|failing|missing|avoiding)|what'?s? wrong with me|pattern)\b/, weight: 2.5 },
    { pattern: /\b(honestly?|if i'?m honest|deep down|truth is)\b/, weight: 1 },
  ],
  accountability_request: [
    { pattern: /\b(keep me (accountable|honest|on track)|hold me (accountable|to it)|check (on me|in with me))\b/, weight: 3 },
    { pattern: /\b(remind me|follow up|don'?t let me|make sure i|push me)\b/, weight: 2 },
    { pattern: /\b(i need (someone|you) to|i want (accountability|to be held))\b/, weight: 2 },
  ],
  emotional_vent: [
    { pattern: /\b(so (tired|exhausted|done|over it)|can'?t (take|do|keep|handle) (it|this|anymore)|had enough)\b/, weight: 2.5 },
    { pattern: /\b(frustrated|overwhelmed|stressed out|burnt? out|losing my mind|breaking down)\b/, weight: 2 },
    { pattern: /\b(ugh|argh|i (hate|can'?t stand) (this|it)|everything is|nothing is)\b/, weight: 1.5 },
  ],
  question: [
    { pattern: /\?$/, weight: 2 },
    { pattern: /^(what|how|why|when|where|should|can|could|would|is|are|do|does|did|will)\b/, weight: 1.5 },
    { pattern: /\b(any (advice|tips?|suggestions?)|what do you think|your thoughts|opinion)\b/, weight: 2 },
  ],
  deadline_set: [
    { pattern: /\b(due (on|by|at)|deadline (is|on|for)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|end of|next))\b/, weight: 3 },
    { pattern: /\b(exam (on|in|at)|submission (on|by|at)|presentation (on|by)|test (on|in))\b/, weight: 2.5 },
    { pattern: /\b(have to (finish|complete|submit|do) by|need to (finish|complete|submit) by)\b/, weight: 2 },
  ],
  schedule_adjust: [
    { pattern: /\b(push (it|this|that) (to|by|back)|delay|postpone|reschedule|move (it|this) to|shift (to|by))\b/, weight: 3 },
    { pattern: /\b(can we (change|adjust|move|shift)|need to (change|adjust|move)|instead of)\b/, weight: 2 },
  ],
  progress_report: [
    { pattern: /\b(so far|progress (on|with|update)|how (i'?m|am i) doing|where (i'?m at|am i))\b/, weight: 2 },
    { pattern: /\b(finished (\d+|half|some|most)|completed (\d+|part)|done with|got through)\b/, weight: 1.5 },
  ],
  check_in_response: [
    { pattern: /^(yes|no|yeah|nope|done|not yet|working on it|almost|kind of|yep|nah|still going|in progress)\b/, weight: 2 },
    { pattern: /\b(just (checked|came|messaged|texting) (in|you|because)|you (asked|messaged|reached out))\b/, weight: 2 },
  ],
  general_chat: [],
};

function scoreIntents(text: string): IntentScores {
  const scores = Object.keys(INTENT_SIGNALS).reduce<IntentScores>((acc, key) => {
    acc[key as MessageIntent] = 0;
    return acc;
  }, {} as IntentScores);

  for (const [intent, signals] of Object.entries(INTENT_SIGNALS)) {
    for (const { pattern, weight } of signals) {
      if (pattern.test(text)) {
        scores[intent as MessageIntent] += weight;
      }
    }
  }

  return scores;
}

function detectPrimaryIntent(normalized: string, context: ConversationContext): MessageIntent {
  const scores = scoreIntents(normalized);

  if (context.previousIntents[0] === 'failure_report' && /\b(because|due to|i had)\b/.test(normalized)) {
    scores.excuse += 1.5;
  }
  if (context.previousIntents[0] === 'accountability_request' && normalized.split(' ').length < 15) {
    scores.check_in_response += 1;
  }

  const sorted = (Object.entries(scores) as Array<[MessageIntent, number]>).sort(([, a], [, b]) => b - a);
  const [topIntent, topScore] = sorted[0];

  if (topScore === 0) return 'general_chat';
  return topIntent;
}

function detectSecondaryIntents(
  normalized: string,
  context: ConversationContext,
  primary: MessageIntent
): MessageIntent[] {
  const scores = scoreIntents(normalized);
  const threshold = 1.0;

  return (Object.entries(scores) as Array<[MessageIntent, number]>)
    .filter(([intent, score]) => intent !== primary && score >= threshold)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([intent]) => intent);
}

// ── Goal extraction ───────────────────────────────────────────────────────────

const GOAL_EXTRACTION_PATTERNS: Array<{ pattern: RegExp; group: number }> = [
  { pattern: /\b(?:want to|wanna|trying to|planning to|hoping to|looking to|need to|aim to|goal is to|going to)\s+(.{5,80}?)(?:\.|,|\bso\b|\bbut\b|\band\b|$)/i, group: 1 },
  { pattern: /\bmy goal is\s+(.{5,80}?)(?:\.|,|$)/i, group: 1 },
  { pattern: /\bi(?:'m| am) working on\s+(.{5,80}?)(?:\.|,|$)/i, group: 1 },
  { pattern: /\bhelp me\s+(.{5,80}?)(?:\.|,|$)/i, group: 1 },
  { pattern: /\blearn\s+(.{3,60}?)(?:\s+(?:from scratch|properly|better|faster|in|\.|,|$))/i, group: 1 },
  { pattern: /\bimprove (?:my\s+)?(.{3,60}?)(?:\.|,|$)/i, group: 1 },
  { pattern: /\bget better at\s+(.{3,60}?)(?:\.|,|$)/i, group: 1 },
  { pattern: /\b(?:crack|prepare for|prep for)\s+(.{3,60}?)(?:\.|,|$)/i, group: 1 },
  { pattern: /\bbuild\s+(?:my\s+)?(.{3,60}?)(?:\.|,|$)/i, group: 1 },
];

const GOAL_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/\b(dsa|data structures?|algorithms?)\b/i, 'learn DSA'],
  [/\b(lose|losing|cut)\s*(weight|fat|body fat)\b/i, 'lose weight'],
  [/\b(gain|build|put on)\s*(muscle|mass|size)\b/i, 'build muscle'],
  [/\b(bulk(ing)?|bulking up)\b/i, 'build muscle'],
  [/\b(placements?|campus (placement|hiring))\b/i, 'crack placements'],
  [/\b(crack|clear|ace)\s*(placement|interview|exams?)\b/i, 'crack placements'],
  [/\b(consistency|be consistent|stay consistent|build consistency)\b/i, 'build consistency'],
  [/\b(wake up early|morning routine|early (riser|bird)|5am)\b/i, 'build morning routine'],
  [/\b(read(ing)? (more|habit)|read every day)\b/i, 'build reading habit'],
  [/\b(stop procrastinat(ing|ion)|overcome procrastination)\b/i, 'overcome procrastination'],
  [/\b(be (more )?productive|improve productivity|productivity)\b/i, 'improve productivity'],
  [/\b(fitness|get fit|get in shape|body transformation|transform)\b/i, 'improve fitness'],
  [/\b(study (for|harder|better|more consistently)|improve (my )?study)\b/i, 'study consistently'],
  [/\b(cod(ing|e better)|programming|software (dev|engineer))\b/i, 'improve coding skills'],
  [/\b(diet|eat (better|clean|healthy|right)|nutrition)\b/i, 'improve diet'],
  [/\b(save money|financial (goal|discipline|freedom))\b/i, 'improve financial discipline'],
  [/\b(meditat(e|ion)|mindfulness|mental (health|peace))\b/i, 'improve mental health'],
  [/\b(stop using (phone|social media|instagram)|screen time|phone addiction)\b/i, 'reduce screen time'],
  [/\b(sleep (better|early|consistently)|fix (my )?sleep)\b/i, 'fix sleep schedule'],
  [/\b(journal(ling|ing)|journaling habit)\b/i, 'build journaling habit'],
];

const VAGUE_GOAL_PATTERN = /^(better|more|less|improve|good|great|best|perfect|success(ful)?|happy|healthy|strong|consistent)\s*$/i;

function extractGoal(normalized: string): DetectedGoal | null {
  let rawGoalText: string | null = null;

  for (const { pattern, group } of GOAL_EXTRACTION_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[group]?.trim() && match[group].trim().length >= 3) {
      rawGoalText = match[group].trim();
      break;
    }
  }

  if (!rawGoalText) return null;

  let normalizedGoal = rawGoalText;
  for (const [pattern, canonical] of GOAL_NORMALIZATIONS) {
    if (pattern.test(normalized)) {
      normalizedGoal = canonical;
      break;
    }
  }

  const isVague = VAGUE_GOAL_PATTERN.test(normalizedGoal) || normalizedGoal.split(' ').length <= 1;
  const domain = classifyDomainFromText(normalizedGoal + ' ' + normalized);
  const horizon = classifyGoalHorizon(normalized);

  return {
    raw: rawGoalText,
    normalized: normalizedGoal,
    domain,
    horizon,
    isVague,
    confidence: isVague ? 0.45 : 0.85,
  };
}

function classifyGoalHorizon(text: string): DetectedGoal['horizon'] {
  if (/\b(today|tonight|right now|this hour|next (\d+) (min|hour)s?)\b/.test(text)) return 'immediate';
  if (/\b(this week|next week|few days|in (\d+) days?|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(text)) return 'short_term';
  if (/\b(this month|next month|in (\d+) weeks?|by (\d+) weeks?|few weeks|30 days|3 months|quarter|by (march|april|may|june|july|august|september|october|november|december))\b/.test(text)) return 'medium_term';
  return 'long_term';
}

// ── Domain classification ─────────────────────────────────────────────────────

const DOMAIN_SIGNALS: Record<Domain, Array<{ pattern: RegExp; weight: number }>> = {
  fitness: [
    { pattern: /\b(gym|workout|training|exercise|fitness|running|jogging|cycling|swimming|lifting|weights?|cardio|hiit|yoga|pilates)\b/, weight: 3 },
    { pattern: /\b(lose weight|gain muscle|body (fat|composition|transformation)|cut|bulk|shred|lean)\b/, weight: 3 },
    { pattern: /\b(bench|squat|deadlift|press|pull.?up|push.?up|plank|crunch)\b/, weight: 2 },
    { pattern: /\b(diet|nutrition|eating|protein|calories|macros|meal prep)\b/, weight: 2 },
    { pattern: /\b(sleep|recovery|soreness|injury|rest day)\b/, weight: 1 },
  ],
  study: [
    { pattern: /\b(study|studying|exam|test|quiz|assignment|homework|lecture|class|course|semester)\b/, weight: 3 },
    { pattern: /\b(dsa|data structures?|algorithms?|leetcode|competitive (programming|coding)|cp)\b/, weight: 3 },
    { pattern: /\b(learn|learning|understand|concept|topic|subject|chapter|syllabus|revision)\b/, weight: 2 },
    { pattern: /\b(college|university|school|degree|graduation|semester|academic)\b/, weight: 2 },
    { pattern: /\b(notes|revision|practice|mock (test|exam)|past papers?)\b/, weight: 1.5 },
  ],
  career: [
    { pattern: /\b(job|work|career|employment|internship|placement|interview|resume|cv|linkedin)\b/, weight: 3 },
    { pattern: /\b(startup|business|entrepreneur|product|launch|client|freelance|project)\b/, weight: 2.5 },
    { pattern: /\b(salary|promotion|appraisal|raise|increment|offer letter|package)\b/, weight: 2.5 },
    { pattern: /\b(networking|referral|connection|skill set|upskill)\b/, weight: 1 },
  ],
  habits: [
    { pattern: /\b(habit|routine|consistency|discipline|daily|streak|system|ritual)\b/, weight: 3 },
    { pattern: /\b(morning|evening|night|wake up|sleep (schedule|time|early|better))\b/, weight: 2 },
    { pattern: /\b(procrastinat(e|ion|ing)|distraction|focus|productive(ity)?)\b/, weight: 2.5 },
    { pattern: /\b(journaling|meditation|reading habit|writing habit)\b/, weight: 1.5 },
    { pattern: /\b(phone|social media|screen time|addiction|quit|stop)\b/, weight: 1.5 },
  ],
  finance: [
    { pattern: /\b(money|finance|financial|save|saving|budget|invest(ing|ment)?|debt|loan)\b/, weight: 3 },
    { pattern: /\b(income|expense|spending|credit card|emi|passive income|wealth)\b/, weight: 2.5 },
    { pattern: /\b(afford|broke|cash flow|net worth)\b/, weight: 2 },
  ],
  mental_health: [
    { pattern: /\b(anxiety|anxious|panic|depress(ed|ion)|mental health|therapy|therapist)\b/, weight: 3 },
    { pattern: /\b(stress(ed)?|overwhelm(ed|ing)|burnout|burnt?( out)?|exhausted|drained)\b/, weight: 2.5 },
    { pattern: /\b(mindfulness|self.?care|self.?compassion|inner peace|calm|grounded)\b/, weight: 2 },
    { pattern: /\b(negative thoughts?|overthinking|spiral|cope|coping)\b/, weight: 2 },
  ],
  relationships: [
    { pattern: /\b(relationship|partner|girlfriend|boyfriend|spouse|wife|husband|family)\b/, weight: 3 },
    { pattern: /\b(friend(ship)?|social|connection|lonely|loneliness|isolat(ed|ion))\b/, weight: 2.5 },
    { pattern: /\b(communicate|communication|trust|boundary|conflict|break.?up)\b/, weight: 2 },
  ],
  creative: [
    { pattern: /\b(write|writing|blog|novel|story|script|content creation)\b/, weight: 3 },
    { pattern: /\b(music|guitar|piano|singing|art|drawing|painting|design)\b/, weight: 3 },
    { pattern: /\b(youtube|podcast|channel|audience|creative (project|work))\b/, weight: 2 },
  ],
  unknown: [],
};

function classifyDomainFromText(text: string): Domain {
  const scores: Record<Domain, number> = {
    fitness: 0, study: 0, career: 0, habits: 0,
    finance: 0, mental_health: 0, relationships: 0, creative: 0, unknown: 0,
  };

  for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
    if (domain === 'unknown') continue;
    for (const { pattern, weight } of signals) {
      if (pattern.test(text)) scores[domain as Domain] += weight;
    }
  }

  const best = (Object.entries(scores) as Array<[Domain, number]>).sort(([, a], [, b]) => b - a)[0];
  return best[1] === 0 ? 'unknown' : best[0];
}

function classifyDomain(normalized: string, context: ConversationContext): Domain {
  if (context.userDomain && context.userDomain !== 'unknown') return context.userDomain;
  return classifyDomainFromText(normalized);
}

// ── Emotion analysis ──────────────────────────────────────────────────────────

const EMOTION_SIGNALS: Record<EmotionType, Array<{ pattern: RegExp; weight: number }>> = {
  frustrated: [
    { pattern: /\b(frustrated?|frustrating|this is (so |really |super )?(hard|difficult|annoying|impossible))\b/, weight: 3 },
    { pattern: /\b(tired of (trying|this|it|failing)|sick of|fed up|nothing (works|is working))\b/, weight: 2.5 },
    { pattern: /\b(ugh|argh|wtf|what (the|is this))\b/, weight: 1.5 },
    { pattern: /!!+/, weight: 0.8 },
  ],
  overwhelmed: [
    { pattern: /\b(overwhelm(ed|ing)|too much|so much (to do|on my plate)|can'?t handle|drowning)\b/, weight: 3 },
    { pattern: /\b(everything (is|at once)|don'?t know where to start|don'?t know what to do|so lost)\b/, weight: 2.5 },
    { pattern: /\b(juggling|balancing|so many things|all at once)\b/, weight: 2 },
  ],
  motivated: [
    { pattern: /\b(motivated|pumped|ready|let'?s (go|do this)|fired up|excited|hyped)\b/, weight: 3 },
    { pattern: /\b(i (can|will|am going to)|determined|committed|making it happen)\b/, weight: 2 },
    { pattern: /\b(no (stopping|excuses|turning back)|this time for real|finally ready)\b/, weight: 2.5 },
  ],
  discouraged: [
    { pattern: /\b(discouraged?|giving up|want to quit|feel like giving up|pointless|useless|hopeless)\b/, weight: 3 },
    { pattern: /\b(not (good enough|making (progress|it)|improving)|never going to|impossible for me)\b/, weight: 2.5 },
    { pattern: /\b(what'?s the point|why (bother|even try)|doesn'?t (matter|help|work))\b/, weight: 2.5 },
  ],
  confused: [
    { pattern: /\b(confused?|confusing|don'?t (understand|know|get)|not sure|unclear)\b/, weight: 3 },
    { pattern: /\b(how (does|do|should)|what (exactly|is|are))\b/, weight: 1.5 },
    { pattern: /\b(i'?m stuck|can (you )?explain|help me understand)\b/, weight: 2 },
  ],
  anxious: [
    { pattern: /\b(anxious|anxiety|nervous|scared|afraid|fear(ful)?|worried?|panick?y?)\b/, weight: 3 },
    { pattern: /\b(what if|scared (of|that|to)|terrified|dreading|apprehensive)\b/, weight: 2 },
    { pattern: /\b(overthinking|can'?t stop thinking|racing (mind|thoughts))\b/, weight: 2.5 },
  ],
  hopeful: [
    { pattern: /\b(hope(ful)?|optimistic|positive|believe (in|i can)|confident|think i can)\b/, weight: 2.5 },
    { pattern: /\b(fresh start|new beginning|turning point|this could work|getting there)\b/, weight: 2 },
    { pattern: /\b(maybe i can|starting to (see|feel|get)|small wins?|making progress)\b/, weight: 1.5 },
  ],
  stressed: [
    { pattern: /\b(stress(ed|ful)?|under (pressure|stress)|too much (pressure|stress))\b/, weight: 3 },
    { pattern: /\b(deadline|crunch time|running out of time|no time)\b/, weight: 2 },
    { pattern: /\b(can'?t (relax|rest|breathe|sleep|focus)|always (tense|worried|stressed))\b/, weight: 2.5 },
  ],
  proud: [
    { pattern: /\b(proud|accomplished|achieved|did it|finally|made it|crushed it)\b/, weight: 3 },
    { pattern: /\b(so happy (about|with)|feeling (good|great) (about|with)|great feeling)\b/, weight: 2 },
    { pattern: /\b(milestone|breakthrough|personal record|best (ever|yet|so far))\b/, weight: 2 },
  ],
  guilty: [
    { pattern: /\b(guilty|feel (bad|terrible|awful|horrible)|should(n'?t)? have)\b/, weight: 3 },
    { pattern: /\b(let (myself|you) down|failed (myself|again)|disappointing)\b/, weight: 2.5 },
    { pattern: /\b(i know i (should|could|was supposed to)|i (messed|screwed) up)\b/, weight: 2 },
  ],
  avoidant: [
    { pattern: /\b(avoid(ing|ed|ance)?|putting (it|this) off|procrastinat(e|ing)|not (yet|doing)|haven'?t (started|done))\b/, weight: 2.5 },
    { pattern: /\b(keep (delaying|postponing|pushing|avoiding)|can'?t bring myself to|don'?t feel like)\b/, weight: 2.5 },
    { pattern: /\b(tomorrow|later|eventually|at some point|not right now)\b/, weight: 0.8 },
  ],
  defensive: [
    { pattern: /\b(i (know|already knew)|you don'?t understand|it'?s? not (that|as) easy|it'?s? (different|complicated|hard) for me)\b/, weight: 2.5 },
    { pattern: /\b(don'?t (judge|lecture|tell) me|stop (judging|telling|pushing)|back off|chill)\b/, weight: 3 },
    { pattern: /\b(in my (case|situation)|for me it'?s? different)\b/, weight: 2 },
  ],
  determined: [
    { pattern: /\b(determined|committed|won'?t (stop|quit|give up)|refuse to|not giving up)\b/, weight: 3 },
    { pattern: /\b(no matter what|whatever it takes|going to (do|make|finish|complete) (this|it))\b/, weight: 2.5 },
    { pattern: /\b(pushing through|keep (going|pushing|trying)|not (stopping|quitting))\b/, weight: 2 },
  ],
  neutral: [],
};

const POSITIVE_EMOTIONS: ReadonlySet<EmotionType> = new Set(['motivated', 'hopeful', 'proud', 'determined']);
const NEGATIVE_EMOTIONS: ReadonlySet<EmotionType> = new Set([
  'frustrated', 'overwhelmed', 'discouraged', 'anxious',
  'stressed', 'guilty', 'avoidant', 'defensive', 'confused',
]);

function analyzeEmotion(normalized: string, raw: string, wordCount: number): EmotionResult {
  const scores: Record<EmotionType, number> = {} as Record<EmotionType, number>;
  for (const emotion of Object.keys(EMOTION_SIGNALS) as EmotionType[]) {
    scores[emotion] = 0;
    for (const { pattern, weight } of EMOTION_SIGNALS[emotion]) {
      if (pattern.test(normalized)) scores[emotion] += weight;
    }
  }

  const exclamations = (raw.match(/!/g) ?? []).length;
  const ellipses = (raw.match(/\.\.\./g) ?? []).length;
  const capsRatio = (raw.match(/[A-Z]/g) ?? []).length / Math.max(raw.replace(/\s/g, '').length, 1);

  if (exclamations >= 2) { scores.frustrated += 0.5; scores.motivated += 0.5; }
  if (ellipses >= 2) { scores.discouraged += 0.5; scores.avoidant += 0.3; }
  if (capsRatio > 0.3 && wordCount < 20) { scores.frustrated += 1; scores.stressed += 0.5; }
  if (wordCount <= 4) scores.neutral += 2;
  if (wordCount >= 80) scores.overwhelmed += 0.5;

  const sorted = (Object.entries(scores) as Array<[EmotionType, number]>)
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  if (sorted.length === 0) {
    return { primary: 'neutral', secondary: null, intensity: 0, valence: 'neutral', confidence: 0.5 };
  }

  const [primary, primaryScore] = sorted[0];
  const secondary = sorted[1]?.[0] ?? null;
  const intensity = Math.min(primaryScore / 10, 1);

  const valence = POSITIVE_EMOTIONS.has(primary)
    ? 'positive'
    : NEGATIVE_EMOTIONS.has(primary)
    ? 'negative'
    : 'neutral';

  const confidence = sorted.length >= 2
    ? Math.min((primaryScore - sorted[1][1]) / Math.max(primaryScore, 1), 1)
    : 0.8;

  return { primary, secondary, intensity, valence, confidence };
}

// ── Constraint detection ──────────────────────────────────────────────────────

interface ConstraintSignal {
  type: ConstraintType;
  pattern: RegExp;
  highSeverityPattern?: RegExp;
  mildSeverityPattern?: RegExp;
  isTemporaryPattern?: RegExp;
}

const CONSTRAINT_SIGNALS: ConstraintSignal[] = [
  {
    type: 'time',
    pattern: /\b(no time|busy|too (busy|much going on)|time crunch|not enough time|packed schedule|hectic|can'?t find time|tight (schedule|timeline))\b/,
    isTemporaryPattern: /\b(this week|today|for now|right now|at the moment|temporarily)\b/,
  },
  {
    type: 'energy',
    pattern: /\b(tired|exhausted|drained|no energy|low energy|burnout|burnt?( out)?|fatigued|spent)\b/,
    highSeverityPattern: /\b(completely (exhausted|drained|done)|can'?t (even|function)|barely (functioning|keeping up))\b/,
    mildSeverityPattern: /\b(a bit (tired|drained)|slightly|kinda tired)\b/,
  },
  {
    type: 'injury',
    pattern: /\b(injury|injured|hurt|pain|sore|sprain|strain|pulled|torn|surgery|recovering)\b/,
    isTemporaryPattern: /\b(healing|recovering|for now|temporary|getting better)\b/,
  },
  {
    type: 'burnout',
    pattern: /\b(burnout|burnt?( out)?|completely (done|over it|exhausted)|at my (limit|breaking point)|can'?t (anymore|keep going))\b/,
  },
  {
    type: 'work_pressure',
    pattern: /\b(work (pressure|stress|crunch|deadline)|project (deadline|crunch|pressure)|boss|client|deliverable|sprint|release)\b/,
    isTemporaryPattern: /\b(this (week|sprint|quarter)|until (deadline|friday|end of (week|month)))\b/,
  },
  {
    type: 'exam_season',
    pattern: /\b(exam(s)?|test(s)?|finals?|midterm|semester (end|exams?)|boards?|entrance (exam|test)|gate|upsc|cat|gre|gmat|jee|neet)\b/,
    isTemporaryPattern: /\b(this (month|week|semester|year)|until (exam|result|clear))\b/,
  },
  {
    type: 'family_responsibility',
    pattern: /\b(family (issue|emergency|responsibility|obligation|commitment)|parents?|sibling|relative|personal (issue|matter|emergency))\b/,
  },
  {
    type: 'financial',
    pattern: /\b(money (issue|problem|tight|stress)|can'?t afford|financial (pressure|stress|issue|constraint)|broke)\b/,
  },
  {
    type: 'mental_health',
    pattern: /\b(depression|anxiety|panic attack|mental health (issue|crisis)|not (okay|well|alright)|struggling (mentally|emotionally))\b/,
  },
  {
    type: 'social_pressure',
    pattern: /\b(everyone (else|around me)|social (pressure|anxiety|comparison)|comparing (myself|to others)|feel behind)\b/,
  },
  {
    type: 'environment',
    pattern: /\b(no (gym|space|equipment|internet|resources|access)|bad (environment|home)|distracting (environment|place|people))\b/,
    isTemporaryPattern: /\b(moving|shifting|temporary|for now|until)\b/,
  },
];

const HIGH_SEVERITY_MODIFIER = /\b(very|extremely|really|so|super|completely|totally|absolutely|cannot|can'?t (at all|anymore))\b/;
const MILD_SEVERITY_MODIFIER = /\b(a (bit|little|tiny bit)|kinda|somewhat|slightly|not too|not very)\b/;

function extractConstraints(normalized: string): DetectedConstraint[] {
  const detected: DetectedConstraint[] = [];

  for (const signal of CONSTRAINT_SIGNALS) {
    const match = normalized.match(signal.pattern);
    if (!match) continue;

    let severity: DetectedConstraint['severity'] = 'moderate';
    if (signal.highSeverityPattern?.test(normalized)) severity = 'severe';
    else if (signal.mildSeverityPattern?.test(normalized)) severity = 'mild';
    else if (HIGH_SEVERITY_MODIFIER.test(normalized)) severity = 'severe';
    else if (MILD_SEVERITY_MODIFIER.test(normalized)) severity = 'mild';

    const isTemporary = signal.isTemporaryPattern
      ? signal.isTemporaryPattern.test(normalized)
      : /\b(for now|temporarily|this week|this month|short.?term)\b/.test(normalized);

    detected.push({ type: signal.type, raw: match[0], severity, isTemporary });
  }

  return detected;
}

// ── Commitment analysis ───────────────────────────────────────────────────────

interface CommitmentMarker {
  pattern: RegExp;
  score: number;
  level: CommitmentLevel;
}

const COMMITMENT_MARKERS: CommitmentMarker[] = [
  { pattern: /\b(i (commit|promise|guarantee|swear|pledge))\b/, score: 0.95, level: 'very_high' },
  { pattern: /\b(no matter what|100%|going all in|all (in|out))\b/, score: 0.92, level: 'very_high' },
  { pattern: /\b(this is non.?negotiable|making this (happen|work)|nothing will stop me)\b/, score: 0.90, level: 'very_high' },
  { pattern: /\b(i (will|am going to|must|have to) (do|start|finish|complete))\b/, score: 0.78, level: 'high' },
  { pattern: /\b(starting (today|now|tonight|tomorrow)|from (now on|today|tomorrow))\b/, score: 0.75, level: 'high' },
  { pattern: /\b(for real (this time)?|seriously (this time)?|i mean it)\b/, score: 0.73, level: 'high' },
  { pattern: /\b(decided to|made up my mind|going to (push|force|make) myself)\b/, score: 0.70, level: 'high' },
  { pattern: /\b(i (plan to|intend to)|planning to|thinking of doing)\b/, score: 0.55, level: 'medium' },
  { pattern: /\b(i'?ll (try to|attempt|give it a (shot|try)|work on))\b/, score: 0.50, level: 'medium' },
  { pattern: /\b(i should|i'?ve been meaning to|i (know|know i) (need|should))\b/, score: 0.45, level: 'medium' },
  { pattern: /\b(i'?ll try( my best)?|maybe (i'?ll|i will)|i'?m trying)\b/, score: 0.30, level: 'low' },
  { pattern: /\b(if (i (can|get the chance|find (time|energy))|possible))\b/, score: 0.25, level: 'low' },
  { pattern: /\b(hopefully|i hope (to|i will)|ideally|at some point|when i get around to)\b/, score: 0.20, level: 'low' },
  { pattern: /\b(i (don'?t know|doubt (it|i will)|not sure (if|whether) i (can|will)))\b/, score: 0.10, level: 'none' },
  { pattern: /\b(probably not|unlikely|wishful thinking)\b/, score: 0.05, level: 'none' },
];

function analyzeCommitment(normalized: string): { commitmentLevel: CommitmentLevel; commitmentScore: number } {
  let highestScore = 0;
  let detectedLevel: CommitmentLevel = 'none';

  for (const { pattern, score, level } of COMMITMENT_MARKERS) {
    if (pattern.test(normalized) && score > highestScore) {
      highestScore = score;
      detectedLevel = level;
    }
  }

  if (highestScore > 0 && /\b(this time|again|unlike before|different this time|last time i)\b/.test(normalized)) {
    highestScore = Math.min(highestScore + 0.08, 1);
  }

  return { commitmentLevel: detectedLevel, commitmentScore: highestScore };
}

// ── Urgency ───────────────────────────────────────────────────────────────────

const URGENCY_SIGNALS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\b(right now|immediately|asap|right away|urgently|emergency|no time to (wait|lose|waste))\b/, score: 0.9 },
  { pattern: /\b(due (today|tonight|in (\d+) (hours?|mins?))|deadline (today|tonight|tomorrow))\b/, score: 0.85 },
  { pattern: /\b(today|tonight|in (\d+) (minutes?|hours?))\b/, score: 0.8 },
  { pattern: /\b(tomorrow|this (evening|morning|afternoon)|by (tomorrow|end of (day|week)))\b/, score: 0.6 },
  { pattern: /\b(running out of time|not much time (left|remaining)|time is (running out|short))\b/, score: 0.7 },
  { pattern: /\b(exam (tomorrow|next week|in (\d+) days?)|interview (tomorrow|soon))\b/, score: 0.7 },
  { pattern: /\b(this week|in (\d+) days?|by (friday|monday|end of week))\b/, score: 0.4 },
  { pattern: /\b(soon|shortly|in a (few|couple of) (days?|weeks?))\b/, score: 0.3 },
  { pattern: /\b(eventually|at some point|when i (can|have time|feel ready)|no rush)\b/, score: 0.05 },
];

function calculateUrgency(
  normalized: string,
  constraints: DetectedConstraint[],
  intent: MessageIntent
): number {
  let score = 0;

  for (const { pattern, score: signalScore } of URGENCY_SIGNALS) {
    if (pattern.test(normalized)) score = Math.max(score, signalScore);
  }

  for (const constraint of constraints) {
    if (constraint.type === 'exam_season') score = Math.max(score, constraint.severity === 'severe' ? 0.75 : 0.45);
    if (constraint.type === 'work_pressure') score = Math.max(score, constraint.severity === 'severe' ? 0.65 : 0.35);
    if (constraint.type === 'injury' && constraint.severity === 'severe') score = Math.max(score, 0.6);
  }

  if (intent === 'deadline_set') score = Math.max(score, 0.6);
  if (intent === 'failure_report') score = Math.max(score, 0.3);

  return Math.min(score, 1);
}

// ── Requested outcome ─────────────────────────────────────────────────────────

const OUTCOME_SIGNALS: Record<RequestedOutcome, Array<{ pattern: RegExp; weight: number }>> = {
  advice: [
    { pattern: /\b(what should i (do|try|focus on)|any (advice|tips?|suggestions?)|how should i|what do you (think|recommend)|recommend(ation)?)\b/, weight: 3 },
    { pattern: /\b(help me (decide|choose|figure out)|which (is better|approach|option)|what'?s? (better|best|ideal))\b/, weight: 2.5 },
    { pattern: /\b(your (take|opinion|thoughts?)|would you (say|recommend|suggest))\b/, weight: 2 },
  ],
  planning: [
    { pattern: /\b(make me a plan|create a (plan|schedule|routine)|plan (for|my)|plan this out|help me (plan|structure|organize))\b/, weight: 3 },
    { pattern: /\b(what'?s? my (plan|schedule|routine)|how to (structure|organize|plan)|breakdown|roadmap|step.by.step)\b/, weight: 2.5 },
    { pattern: /\b(schedule|routine|plan|system)\b.{0,20}\b(for me|going forward|from (now|today))\b/, weight: 2 },
  ],
  accountability: [
    { pattern: /\b(keep me (accountable|honest|on track)|hold me (to it|accountable)|check (on me|in with me)|follow.?up (with me)?)\b/, weight: 3 },
    { pattern: /\b(remind me|don'?t let me|make sure i (do|don'?t|stay)|push me (to|if))\b/, weight: 2.5 },
    { pattern: /\b(track (my|this)|i need (accountability|to be held|someone to))\b/, weight: 2 },
  ],
  learning: [
    { pattern: /\b(how (does|do)|explain|what (is|are|does)|teach me|i want to (understand|learn|know))\b/, weight: 3 },
    { pattern: /\b(can you (explain|teach|break down|walk me through)|help me understand|what'?s? the (difference|concept|meaning))\b/, weight: 2.5 },
    { pattern: /\b(break (it|this) down|walk me through|from the basics|beginner)\b/, weight: 2 },
  ],
  reflection: [
    { pattern: /\b(thinking about|reflecting? on|looking back|in hindsight|why (do|did|am) i|why (does|is) this (happen|pattern))\b/, weight: 3 },
    { pattern: /\b(what'?s? (wrong with|going on with) me|what (does this|does it) (say about|mean for))\b/, weight: 2.5 },
    { pattern: /\b(understand (myself|my pattern|my behavior)|self.?aware(ness)?|honest (with myself|assessment))\b/, weight: 2 },
  ],
  motivation: [
    { pattern: /\b(motivate me|i need (motivation|a push|encouragement)|feel (demotivated|unmotivated|uninspired))\b/, weight: 3 },
    { pattern: /\b(help me (get started|stay motivated|keep going)|push me|losing (motivation|steam))\b/, weight: 2.5 },
    { pattern: /\b(can'?t (get started|bring myself to|find (motivation|energy|drive)))\b/, weight: 2 },
  ],
  venting: [
    { pattern: /\b(just (needed|wanted|had) to (vent|say this|let (that|this) out|tell someone)|not looking for (advice|solutions?)|just (talking|venting|processing))\b/, weight: 3 },
    { pattern: /\b(don'?t (need|want) (advice|a plan|solutions?)|just (hear|listen|wanted you to know))\b/, weight: 2.5 },
  ],
  status_acknowledgment: [
    { pattern: /^(update|just (checking|letting|wanted)|i (did|completed|finished|worked on|trained|studied))\b/, weight: 3 },
    { pattern: /\b(here'?s? (my|the|an) update|letting you know|quick (update|check.?in)|reporting back)\b/, weight: 2.5 },
    { pattern: /\b(wanted to (update|tell|let) you|just (checking in|touching base))\b/, weight: 2 },
  ],
  none: [],
};

const INTENT_DEFAULT_OUTCOME: Partial<Record<MessageIntent, RequestedOutcome>> = {
  plan_request: 'planning',
  accountability_request: 'accountability',
  question: 'advice',
  reflection: 'reflection',
  emotional_vent: 'venting',
  status_update: 'status_acknowledgment',
  progress_report: 'status_acknowledgment',
  check_in_response: 'status_acknowledgment',
};

function detectRequestedOutcome(normalized: string, intent: MessageIntent): RequestedOutcome {
  const scores: Record<RequestedOutcome, number> = {
    advice: 0, planning: 0, accountability: 0, learning: 0,
    reflection: 0, motivation: 0, venting: 0, status_acknowledgment: 0, none: 0,
  };

  for (const [outcome, signals] of Object.entries(OUTCOME_SIGNALS)) {
    if (outcome === 'none') continue;
    for (const { pattern, weight } of signals) {
      if (pattern.test(normalized)) scores[outcome as RequestedOutcome] += weight;
    }
  }

  const best = (Object.entries(scores) as Array<[RequestedOutcome, number]>)
    .filter(([k]) => k !== 'none')
    .sort(([, a], [, b]) => b - a)[0];

  if (best[1] >= 1.5) return best[0];
  return INTENT_DEFAULT_OUTCOME[intent] ?? 'none';
}

// ── Binary helpers ────────────────────────────────────────────────────────────

function detectFailureReport(normalized: string): boolean {
  return /\b(didn'?t|did not|couldn'?t|could not|failed to|missed|skipped|wasn'?t able|fell off|gave up|quit|stopped|haven'?t been|lost track)\b/.test(normalized);
}

function detectExcuse(normalized: string): boolean {
  if (!detectFailureReport(normalized)) return false;
  return /\b(because|since|due to|i had|i was|it (was|is)|something came up|got (busy|caught up|sick)|wasn'?t (feeling|able)|couldn'?t (help|control|avoid))\b/.test(normalized);
}

function detectIsQuestion(raw: string, normalized: string): boolean {
  if (raw.trimEnd().endsWith('?')) return true;
  return /^(what|how|why|when|where|should|can|could|would|is|are|do|does|did|will|have|has)\b/.test(normalized);
}

function detectIsRepeat(normalized: string, context: ConversationContext): boolean {
  if (context.previousIntents.length === 0) return false;
  const current = detectPrimaryIntent(normalized, EMPTY_CONTEXT);
  return context.previousIntents.slice(0, 2).includes(current);
}

function calculateConfidence(
  normalized: string,
  intent: MessageIntent,
  goal: DetectedGoal | null,
  emotion: EmotionResult,
  wordCount: number
): number {
  let confidence = 0.55;

  if (intent !== 'general_chat') confidence += 0.10;
  if (goal !== null && !goal.isVague) confidence += 0.10;
  if (emotion.confidence > 0.7) confidence += 0.08;
  if (wordCount < 5) confidence -= 0.15;
  if (wordCount >= 10) confidence += 0.05;
  if (wordCount >= 20) confidence += 0.05;

  return parseFloat(Math.min(Math.max(confidence, 0.1), 1.0).toFixed(2));
}
