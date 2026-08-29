const { AgentGodoyOutputSchema, agentGodoyJsonSchema } = require('./contracts');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env['gemini-api'] || '';
const AGENT_INSTRUCTIONS = 'You are Agent Godoy, a cautious running-evidence analyst. Distinguish observations from possibilities. Never diagnose, prescribe treatment, or imply medical clearance. Ask questions that reduce uncertainty. Return three or four distinct, low-risk, measurable interventions that can each become a reusable challenge object for friends or a live run. Every intervention must have at least two success criteria and at least two measures to collect. Make every challenge safe even when money is pledged: a safety stop must count as responsible completion. Use only the supplied data and never infer identity or exact location.';

const round = (value, places = 1) => Math.round(Number(value) * 10 ** places) / 10 ** places;

function deterministicAssessment({ context, snapshot, additionalContext }) {
  const evidence = snapshot.evidence || {};
  const runCount = Number(context.summary.run_count || 0);
  const freshness = evidence.freshnessDays;
  const loadChange = evidence.loadChangePct;
  const recentDistance = evidence.recentDistanceKm;
  const hasSelfReport = additionalContext.length > 0;
  const loadDirection = loadChange == null ? 'cannot yet be compared with a baseline' :
    `${loadChange >= 0 ? 'rose' : 'fell'} by ${Math.abs(round(loadChange))}% against the previous four runs`;
  const possibilityLabel = freshness != null && freshness > 30 ? 'The available training picture may be stale' :
    loadChange != null && loadChange > 35 ? 'Recent load change may be affecting running response' :
    'The recent running pattern may be broadly stable';
  const possibilityRationale = freshness != null && freshness > 30 ?
    'The most recent activity is too old to represent current capacity, recovery, symptoms, or routine.' :
    loadChange != null && loadChange > 35 ?
      'A marked short-window distance increase can coincide with higher fatigue, but the activity data cannot determine cause or clinical significance.' :
      'The short-window pace and distance comparison does not show a strong directional signal, although missing recovery and symptom data limit interpretation.';
  const usualDistance = context.observations.length ?
    round(context.observations.slice(0, 4).reduce((sum, row) => sum + Number(row.distance_meters), 0) / Math.max(1, Math.min(4, context.observations.length)) / 1000) : 4;
  const baselineTarget = Math.max(2, Math.min(15, round(usualDistance, 1)));
  const safeStop = 'Stop the challenge for pain, chest discomfort, dizziness, faintness, or unusual breathlessness. Do not use a stake as a reason to continue; seek appropriate care when symptoms warrant it.';

  return AgentGodoyOutputSchema.parse({
    assessment: {
      headline: snapshot.stateLabel,
      summary: `Across ${runCount} imported or recorded runs, the latest four total ${recentDistance ?? 'an unknown number of'} km and ${loadDirection}. This is a running-pattern assessment, not a medical diagnosis.`,
      evidenceSignals: [
        { label: 'Recent distance load', observation: loadChange == null ? 'A comparable eight-run window is not available.' : `${recentDistance} km across the latest four runs; ${loadDirection}.`, source: 'derived' },
        { label: 'Moving pace', observation: evidence.recentPaceSecondsPerKm ? `Recent median moving pace is ${Math.floor(evidence.recentPaceSecondsPerKm / 60)}:${String(evidence.recentPaceSecondsPerKm % 60).padStart(2, '0')} per km.` : 'Recent pace is unavailable.', source: 'strava' },
        { label: 'Current context coverage', observation: hasSelfReport ? `${additionalContext.length} user-supplied context item(s) are included.` : 'No current symptoms, recovery, schedule, or goal context has been added.', source: hasSelfReport ? 'self-report' : 'derived' },
      ],
      possibilities: [
        { label: possibilityLabel, rationale: possibilityRationale, confidence: 'moderate' },
        { label: 'Recovery or life context could explain variation', rationale: 'Sleep, illness, stress, pain, medication, terrain, and weather are not reliably captured in the available aggregate activity records.', confidence: 'low' },
      ],
      limitations: [
        'Activity records cannot establish a medical diagnosis or fitness to exercise.',
        'Aggregate GPS and Strava metrics do not explain why a change occurred.',
        hasSelfReport ? 'User-supplied context is self-reported and has not been clinically verified.' : 'Current goals, symptoms, sleep, and recovery context are missing.',
      ],
      safetyTriage: 'needs-clarification',
    },
    questions: [
      { id: 'current-goal', question: 'What are you trying to improve right now: consistency, distance, pace, enjoyment, or something else?', whyItMatters: 'A useful intervention should test the person’s goal rather than optimise an arbitrary activity metric.', answerType: 'single-choice', options: ['Consistency', 'Distance', 'Pace', 'Enjoyment', 'Return after a break'] },
      { id: 'warning-symptoms', question: 'During or after recent runs, have you had pain, chest discomfort, dizziness, faintness, or unusual breathlessness?', whyItMatters: 'A reported warning symptom should stop a peer-funded physical challenge and prompt appropriate professional advice.', answerType: 'multi-choice', options: ['None', 'Pain', 'Chest discomfort', 'Dizziness or faintness', 'Unusual breathlessness'] },
      { id: 'effort', question: 'How hard did the last three runs feel on a 0–10 scale?', whyItMatters: 'Perceived effort helps distinguish a similar-looking run that felt easy from one that felt unusually difficult.', answerType: 'number', options: [] },
      { id: 'recovery', question: 'How have sleep, illness, stress, and rest days changed over the last two weeks?', whyItMatters: 'Recovery and life context can affect performance but are missing from GPS and Strava aggregates.', answerType: 'text', options: [] },
    ],
    interventions: [
      {
        id: 'controlled-baseline', title: 'Conversational baseline run',
        rationale: 'A repeatable easy run adds a comparable observation without asking the runner to chase pace or distance.',
        instructions: `Complete one familiar route of about ${baselineTarget} km at conversational effort. Record effort and any warning symptoms immediately afterward.`, durationDays: 7,
        successCriteria: [`Complete about ${baselineTarget} km without racing`, 'Perceived effort is recorded', 'No warning symptom is ignored'],
        measuresToCollect: ['GPS distance', 'moving time', 'perceived effort', 'warning symptoms'], safetyStop: safeStop,
        challenge: { title: `The ${baselineTarget} km easy-evidence run`, description: 'Complete one controlled, conversational run and report how it actually felt.', suggestedStakeMinor: 500, currency: 'GBP', fundingCapMinor: 5000, editableFields: ['title', 'description', 'dueAt', 'stake'], settlementRule: 'Release the pledge only when the run and post-run effort check are recorded; any safety stop counts as responsible completion, never failure.' },
      },
      {
        id: 'three-run-effort-log', title: 'Three-run effort check',
        rationale: 'Repeated perceived-effort data fills one of the largest evidence gaps without increasing training load.',
        instructions: 'For the next three normal runs, do not add distance for the challenge. Record effort from 0–10, sleep quality, and any warning symptoms.', durationDays: 14,
        successCriteria: ['Log three normal runs', 'Add an effort score after every run', 'Record sleep context and symptoms honestly'],
        measuresToCollect: ['perceived effort', 'sleep quality', 'GPS distance', 'warning symptoms'], safetyStop: safeStop,
        challenge: { title: 'Three honest check-ins', description: 'Build a better evidence baseline by logging effort and recovery after three ordinary runs.', suggestedStakeMinor: 750, currency: 'GBP', fundingCapMinor: 7500, editableFields: ['title', 'description', 'dueAt', 'stake'], settlementRule: 'Release the pledge for completing all three honest check-ins, regardless of pace or distance.' },
      },
      {
        id: 'recovery-reset', title: 'Recovery-first observation week',
        rationale: 'Holding intensity steady while adding recovery context can reveal whether recent variation tracks with sleep or stress.',
        instructions: 'Keep runs easy for seven days, include at least one rest day, and record sleep quality and perceived effort each day.', durationDays: 7,
        successCriteria: ['No hard effort is added for the challenge', 'At least one rest day is logged', 'Sleep and effort are recorded'],
        measuresToCollect: ['rest days', 'sleep quality', 'perceived effort', 'warning symptoms'], safetyStop: safeStop,
        challenge: { title: 'Protect the easy week', description: 'Friends or a brand back a week of honest recovery data—not more intensity.', suggestedStakeMinor: 1000, currency: 'GBP', fundingCapMinor: 10000, editableFields: ['title', 'description', 'dueAt', 'stake'], settlementRule: 'Release the pledge for following the recovery plan and logging the data; speed is irrelevant.' },
      },
    ],
    disclaimer: 'Agent Godoy identifies patterns, questions, and bounded experiments from limited fitness data. It does not diagnose, prescribe treatment, or clear anyone for exercise.',
  });
}

function modelInput({ context, snapshot, additionalContext }) {
  return {
    aggregateSummary: context.summary,
    recentRuns: context.observations.map(row => ({
      source: row.source,
      occurredAt: row.occurred_at,
      distanceMeters: Number(row.distance_meters),
      movingSeconds: Number(row.moving_seconds),
      averageHeartRate: row.average_heart_rate == null ? null : Number(row.average_heart_rate),
      perceivedExertion: row.perceived_exertion == null ? null : Number(row.perceived_exertion),
    })),
    derivedSnapshot: snapshot,
    userSuppliedContext: additionalContext.map(item => ({ category: item.category, label: item.label, value: item.value, createdAt: item.created_at })),
  };
}

function geminiSchema(value) {
  if(Array.isArray(value))return value.map(geminiSchema);
  if(!value||typeof value!=='object')return value;
  const supported=new Set(['type','properties','required','enum','items','title','description']);
  return Object.fromEntries(Object.entries(value).filter(([key])=>supported.has(key)).map(([key,item])=>[
    key,key==='properties'?Object.fromEntries(Object.entries(item).map(([name,schema])=>[name,geminiSchema(schema)])):geminiSchema(item)
  ]));
}

async function callOpenAI(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        instructions: AGENT_INSTRUCTIONS,
        input: JSON.stringify(input),
        text: { format: { type: 'json_schema', name: 'agent_godoy_assessment', strict: true, schema: agentGodoyJsonSchema } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
    const payload = await response.json();
    const outputText = payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    if (!outputText) throw new Error('OpenAI returned no structured output');
    return AgentGodoyOutputSchema.parse(JSON.parse(outputText));
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(input,model) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),50000);
  try {
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:'POST',
      headers:{'x-goog-api-key':GEMINI_API_KEY,'Content-Type':'application/json'},
      signal:controller.signal,
      body:JSON.stringify({
        systemInstruction:{parts:[{text:AGENT_INSTRUCTIONS}]},
        contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],
        generationConfig:{responseMimeType:'application/json',responseJsonSchema:geminiSchema(agentGodoyJsonSchema),temperature:0.2,maxOutputTokens:6000},
      }),
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(`Gemini request failed with status ${response.status} (${payload.error?.status||'unknown'}): ${String(payload.error?.message||'no detail').slice(0,600)}`);error.status=response.status;throw error;}
    const outputText=payload.candidates?.[0]?.content?.parts?.filter(part=>typeof part.text==='string').map(part=>part.text).join('');
    if(!outputText)throw new Error(`Gemini returned no structured output (${payload.candidates?.[0]?.finishReason||'unknown'})`);
    return AgentGodoyOutputSchema.parse(JSON.parse(outputText));
  } finally {
    clearTimeout(timeout);
  }
}

async function runAgentGodoy(input, { allowModel = true } = {}) {
  const fallback = deterministicAssessment(input);
  if (!allowModel) return { result: fallback, mode: 'deterministic-fallback', provider: null, model: null };
  if(GEMINI_API_KEY){
    const models=[...new Set([GEMINI_MODEL,'gemini-3.7-flash'])];let lastError;
    for(const model of models){
      try {
        const result=await callGemini(modelInput(input),model);
        return {result,mode:'gemini-structured-output',provider:'google',model};
      } catch(error) {
        lastError=error;
        if(![429,503].includes(error.status)&&!Array.isArray(error.issues))break;
      }
    }
    console.error('Agent Godoy Gemini fallback:',lastError.message);
    return {result:fallback,mode:'deterministic-fallback',provider:'google-unavailable',model:GEMINI_MODEL};
  }
  if (!OPENAI_API_KEY) return { result: fallback, mode: 'deterministic-fallback', provider: null, model: null };
  try {
    const result = await callOpenAI(modelInput(input));
    return { result, mode: 'openai-structured-output', provider: 'openai', model: OPENAI_MODEL };
  } catch (error) {
    console.error('Agent Godoy model fallback:', error.message);
    return { result: fallback, mode: 'deterministic-fallback', provider: 'openai-unavailable', model: OPENAI_MODEL };
  }
}

module.exports = { runAgentGodoy };
