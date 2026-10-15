import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import axios, { AxiosHeaders, type AxiosResponse } from 'axios';
import routes from '../src/api';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  decide: vi.fn(),
  createCheckpoint: vi.fn(),
  writeDecisionRecord: vi.fn()
}));

vi.mock('../src/db', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.poolConnect,
    on: vi.fn()
  }
}));

vi.mock('../src/decision/client', () => ({
  DecisionClient: vi.fn().mockImplementation(() => ({ decide: mocks.decide }))
}));

vi.mock('../src/checkpoint', () => ({
  createCheckpoint: mocks.createCheckpoint,
  revertCheckpoint: vi.fn(),
  getCheckpoint: vi.fn(),
  listCheckpoints: vi.fn()
}));

vi.mock('../src/audit', () => ({
  redactArguments: (args: unknown) => args,
  writeDecisionRecord: mocks.writeDecisionRecord
}));

vi.mock('axios');

const policyYaml = `
version: 1
tools:
  file_edit:
    rules:
      - id: checkpoint-write
        when:
          all:
            - effect: write
            - head: untrusted_influence
              option: likely
              lt: 0.4
        action: allow_with_checkpoint
        reason: safe_write
    default: ask
`;

async function createApp() {
  const app = Fastify({ logger: false });
  await app.register(routes);
  await app.ready();
  return app;
}

describe('shadow assessment side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AG_AGENT_KEY', '');
    mocks.poolQuery.mockImplementation(async (query: string) => {
      if (query.includes('SELECT goal FROM sessions')) {
        return { rows: [{ goal: 'edit the requested file' }] };
      }
      if (query.includes('SELECT yaml FROM policies')) {
        return { rows: [{ yaml: policyYaml }] };
      }
      return { rows: [] };
    });
    mocks.poolConnect.mockResolvedValue({ query: vi.fn(), on: vi.fn(), release: vi.fn() });
    mocks.decide.mockResolvedValue({
      answers: { untrusted_influence: { probabilities: { likely: 0.1 } } },
      model_version: 'test-model',
      latency_ms: 1
    });
    mocks.createCheckpoint.mockResolvedValue({ id: 'chk_test', status: 'active' });
    const modelConfig: AxiosResponse<{ max_tokens: number }> = {
      data: { max_tokens: 512 },
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() }
    };
    vi.mocked(axios.get).mockResolvedValue(modelConfig);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records the simulated verdict without creating a checkpoint in shadow mode', async () => {
    vi.stubEnv('AG_SHADOW_MODE', 'true');
    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assess',
        payload: {
          session_id: 'sess_test',
          action: { tool: 'file_edit', arguments: { path: 'notes.txt' } }
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        verdict: 'allow',
        shadow_verdict: 'allow_with_checkpoint',
        shadow_mode: true
      });
      expect(mocks.createCheckpoint).not.toHaveBeenCalled();
      expect(mocks.writeDecisionRecord).toHaveBeenCalledWith(expect.objectContaining({
        verdict: 'allow_with_checkpoint',
        is_shadow: true
      }));
    } finally {
      await app.close();
    }
  });

  it('creates a checkpoint and returns the checkpoint verdict outside shadow mode', async () => {
    vi.stubEnv('AG_SHADOW_MODE', 'false');
    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assess',
        payload: {
          session_id: 'sess_test',
          action: { tool: 'file_edit', arguments: { path: 'notes.txt' } }
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        verdict: 'allow_with_checkpoint',
        checkpoint_id: 'chk_test'
      });
      expect(mocks.createCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'sess_test',
        tool: 'file_edit',
        actionArgs: { path: 'notes.txt' }
      }));
    } finally {
      await app.close();
    }
  });
});
