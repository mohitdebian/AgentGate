import { z } from 'zod';
import { classifyToolEffects, Effect } from './effects';

export const ConditionSchema = z.object({
  all: z.array(z.any()).optional(),
  any: z.array(z.any()).optional(),
  head: z.string().optional(),
  option: z.string().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  effect: z.string().optional(),
  effects: z.union([z.string(), z.array(z.string())]).optional(),
  has_effect: z.string().optional(),
  any_effect: z.union([z.string(), z.array(z.string())]).optional()
});

export const RuleSchema = z.object({
  id: z.string(),
  when: ConditionSchema,
  action: z.enum(['allow', 'allow_with_checkpoint', 'ask', 'deny']),
  reason: z.string(),
  expires_at: z.string().datetime({ offset: true }).optional()
});

export const ToolPolicySchema = z.object({
  trust: z.string().optional(),
  rules: z.array(RuleSchema).optional(),
  default: z.enum(['allow', 'allow_with_checkpoint', 'ask', 'deny']).optional(),
  on_model_error: z.enum(['allow', 'allow_with_checkpoint', 'ask', 'deny']).optional(),
  send_raw_to_model: z.boolean().optional()
});

export const PolicySchema = z.object({
  version: z.number(),
  defaults: z.object({
    on_model_error: z.enum(['allow', 'allow_with_checkpoint', 'ask', 'deny']).optional(),
    abstain: z.object({
      heads: z.array(z.string()),
      max_prob_below: z.number()
    }).optional()
  }).optional(),
  tools: z.record(z.string(), ToolPolicySchema)
});

export type Policy = z.infer<typeof PolicySchema>;

type ConditionResult = boolean | 'model_error';

function evaluateConditionResult(cond: any, heads: any, effects: Effect[] = []): ConditionResult {
  if (cond.all) {
    let hasModelError = false;
    for (const condition of cond.all) {
      const result = evaluateConditionResult(condition, heads, effects);
      if (result === false) return false;
      if (result === 'model_error') hasModelError = true;
    }
    return hasModelError ? 'model_error' : true;
  }
  if (cond.any) {
    let hasModelError = false;
    for (const condition of cond.any) {
      const result = evaluateConditionResult(condition, heads, effects);
      if (result === true) return true;
      if (result === 'model_error') hasModelError = true;
    }
    return hasModelError ? 'model_error' : false;
  }

  let hasCheck = false;

  if (cond.effect !== undefined) {
    hasCheck = true;
    if (effects.length === 0 || !effects.every(e => e === cond.effect)) return false;
  }

  if (cond.effects !== undefined) {
    hasCheck = true;
    const allowed = Array.isArray(cond.effects) ? cond.effects : [cond.effects];
    if (effects.length === 0 || !effects.every(e => allowed.includes(e))) return false;
  }

  if (cond.has_effect !== undefined) {
    hasCheck = true;
    if (!effects.includes(cond.has_effect)) return false;
  }

  if (cond.any_effect !== undefined) {
    hasCheck = true;
    const targets = Array.isArray(cond.any_effect) ? cond.any_effect : [cond.any_effect];
    if (!targets.some((e: any) => effects.includes(e))) return false;
  }

  if (cond.head && cond.option) {
    hasCheck = true;
    if (!heads || !heads[cond.head] || !heads[cond.head].probabilities) {
      console.warn(`[WARNING] Missing head in model response: ${cond.head}`);
      return 'model_error';
    }
    const prob = heads[cond.head].probabilities[cond.option];
    if (prob === undefined) {
      console.warn(`[WARNING] Missing option '${cond.option}' for head '${cond.head}'`);
      return 'model_error';
    }
    
    if (cond.gt !== undefined && prob <= cond.gt) return false;
    if (cond.lt !== undefined && prob >= cond.lt) return false;
  }

  return hasCheck;
}

export function evaluateCondition(cond: any, heads: any, effects: Effect[] = []): boolean {
  return evaluateConditionResult(cond, heads, effects) === true;
}

export function strictestAction(actions: string[]): string {
  if (actions.includes('deny')) return 'deny';
  if (actions.includes('ask')) return 'ask';
  if (actions.includes('allow_with_checkpoint')) return 'allow_with_checkpoint';
  return 'allow';
}

export function matchesPattern(pattern: string, tool: string): boolean {
  if (pattern === tool) return true;
  if (pattern === '*') return true;
  if (!pattern.includes('*') && !pattern.includes('?')) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(tool);
}

export function resolveToolConfig(tool: string, policy: Policy): z.infer<typeof ToolPolicySchema> {
  if (policy.tools[tool]) {
    return policy.tools[tool];
  }
  const patternKeys = Object.keys(policy.tools).filter(k => k !== '*' && (k.includes('*') || k.includes('?')));
  patternKeys.sort((a, b) => b.length - a.length);
  for (const pattern of patternKeys) {
    if (matchesPattern(pattern, tool)) {
      return policy.tools[pattern];
    }
  }
  return policy.tools['*'] || {};
}

export function evaluatePolicy(
  tool: string,
  heads: any,
  policy: Policy,
  actionTruncated: boolean = false,
  toolArgs?: any
): { verdict: string, reason_codes: string[], effects: Effect[] } {
  const toolConfig = resolveToolConfig(tool, policy);
  const rules = toolConfig.rules || [];
  const effects = classifyToolEffects(tool, toolArgs);
  let hasModelError = false;
  let hasInvalidExpiry = false;

  const matchedRules = rules.filter(r => {
    if (r.expires_at !== undefined) {
      if (typeof r.expires_at !== 'string') {
        hasInvalidExpiry = true;
        return false;
      }
      const expiry = new Date(r.expires_at).getTime();
      if (!Number.isFinite(expiry)) {
        hasInvalidExpiry = true;
        return false;
      }
      if (Date.now() > expiry) {
        console.warn(`[WARNING] Policy rule '${r.id}' expired at ${r.expires_at}; skipping evaluation.`);
        return false;
      }
    }
    const result = evaluateConditionResult(r.when, heads, effects);
    if (result === 'model_error') hasModelError = true;
    return result === true;
  });

  const actions = matchedRules.map(r => r.action);
  if (actions.length === 0) {
    actions.push(toolConfig.default || "allow");
  }
  
  const reasons = matchedRules.map(r => r.reason);
  
  if (actionTruncated) {
    actions.push("ask");
    reasons.push("action_truncated");
  }
  
  if (policy.defaults?.abstain) {
    const abstain = policy.defaults.abstain;
    let abstainTriggered = false;
    for (const headName of abstain.heads) {
      const probabilities = heads?.[headName]?.probabilities;
      if (!probabilities || Object.keys(probabilities).length === 0) {
        hasModelError = true;
        continue;
      }
      const probs = Object.values(probabilities) as number[];
      const maxProb = Math.max(...probs);
      if (maxProb < abstain.max_prob_below) {
        abstainTriggered = true;
      }
    }
    if (abstainTriggered) {
      actions.push("ask");
      reasons.push("abstain_low_confidence");
    }
  }

  if (hasModelError) {
    const errorAction = toolConfig.on_model_error || policy.defaults?.on_model_error || 'ask';
    actions.push(errorAction);
    reasons.push('model_error');
  }
  if (hasInvalidExpiry) {
    actions.push('ask');
    reasons.push('invalid_rule_expiration');
  }
  
  const verdict = strictestAction(actions);
  return { verdict, reason_codes: reasons, effects };
}
