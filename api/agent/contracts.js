const { z } = require('zod');

const EvidenceSignalSchema = z.object({
  label: z.string().min(1).max(80),
  observation: z.string().min(1).max(280),
  source: z.enum(['strava', 'gps', 'self-report', 'derived']),
}).strict();

const PossibilitySchema = z.object({
  label: z.string().min(1).max(100),
  rationale: z.string().min(1).max(420),
  confidence: z.enum(['low', 'moderate']),
}).strict();

const QuestionSchema = z.object({
  id: z.string().min(1).max(60),
  question: z.string().min(1).max(240),
  whyItMatters: z.string().min(1).max(280),
  answerType: z.enum(['text', 'number', 'single-choice', 'multi-choice']),
  options: z.array(z.string().min(1).max(80)).max(8),
}).strict();

const ChallengeSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(360),
  suggestedStakeMinor: z.number().int().min(0).max(100000),
  currency: z.enum(['GBP', 'EUR', 'USD']),
  fundingCapMinor: z.number().int().min(0).max(1000000),
  editableFields: z.array(z.enum(['title', 'description', 'dueAt', 'stake'])).min(1),
  settlementRule: z.string().min(1).max(240),
}).strict();

const InterventionSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(100),
  rationale: z.string().min(1).max(420),
  instructions: z.string().min(1).max(600),
  durationDays: z.number().int().min(1).max(28),
  successCriteria: z.array(z.string().min(1).max(200)).min(2).max(6),
  measuresToCollect: z.array(z.string().min(1).max(100)).min(2).max(8),
  safetyStop: z.string().min(1).max(360),
  challenge: ChallengeSchema,
}).strict();

const AgentGodoyOutputSchema = z.object({
  assessment: z.object({
    headline: z.string().min(1).max(120),
    summary: z.string().min(1).max(600),
    evidenceSignals: z.array(EvidenceSignalSchema).min(1).max(8),
    possibilities: z.array(PossibilitySchema).min(1).max(4),
    limitations: z.array(z.string().min(1).max(220)).min(1).max(6),
    safetyTriage: z.enum(['no-reported-red-flags', 'needs-clarification', 'stop-and-seek-care']),
  }).strict(),
  questions: z.array(QuestionSchema).min(2).max(8),
  interventions: z.array(InterventionSchema).min(1).max(4),
  disclaimer: z.string().min(1).max(360),
}).strict();

const ContextEntryInputSchema = z.object({
  category: z.enum(['goal', 'symptoms', 'recovery', 'medical', 'schedule', 'other']),
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(2000),
}).strict();

const ChallengeUpdateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(360),
  dueAt: z.string().datetime(),
  fundingTargetMinor: z.number().int().min(0).max(1000000),
  currency: z.enum(['GBP', 'EUR', 'USD']),
}).strict();

const PledgeInputSchema = z.object({
  contributorName: z.string().trim().min(1).max(80),
  contributorKind: z.enum(['friend', 'brand']),
  amountMinor: z.number().int().min(100).max(100000),
  currency: z.enum(['GBP', 'EUR', 'USD']),
}).strict();

module.exports = {
  AgentGodoyOutputSchema,
  ContextEntryInputSchema,
  ChallengeUpdateSchema,
  PledgeInputSchema,
  agentGodoyJsonSchema: z.toJSONSchema(AgentGodoyOutputSchema),
};
