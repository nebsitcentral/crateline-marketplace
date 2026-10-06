import React from 'react';
import { now, DAY, HOUR } from '@crateline/domain/clock.js';
import { DomainError, fmtMoney, toC, can, roleOf, key, storeBuckets, orderBuckets, refundableC, paidC, refundedC, reservedRefundC, requestRefund, editRefundAmount, executeRefund, refundProviderEvent, executePayout, payoutProviderEvent, reconcilePayout, cancelPayout, changePayoutDestination, decideApproval, approvalCheck, limitFor, platformTotals, sellerFundsAll, S, audit } from '@crateline/domain/fin.js';
import { fmtDT, fmtDate, rel, tzName, STATUS_LABEL, money, isOverdue } from '@crateline/domain/logic.js';
import { Icon, Btn, Badge, Modal, Field, Notice, Empty, Table, KV, Section, Stat, Sim, Seg, useApp } from './ui.jsx';
import { M, useGate, PageTitle, AList, DetailHead, DTabs, DetailGrid, SidePanel, ReasonDialog, AuditTrail, ExportButton } from './admin-ui.jsx';
import * as O from '@crateline/domain/ops.js';
import { apiEnabled, api } from './api.js';
const { useState, useEffect } = React;

const RF_T = { Requested: 'info', Approved: 'accent', 'Changes requested': 'warn', Rejected: 'bad', Processing: 'warn', Refunded: 'ok', 'Partially refunded': 'ok', Failed: 'bad', 'Reconciliation required': 'warn' };
const PO_T = { 'Awaiting approval': 'info', Approved: 'accent', 'Changes requested': 'warn', Processing: 'warn', Paid: 'ok', Failed: 'bad', Cancelled: 'muted', Rejected: 'bad', 'Reconciliation required': 'warn' };
const AP_T = { Pending: 'info', Approved: 'ok', Rejected: 'bad', 'Changes requested': 'warn', Expired: 'muted', Invalidated: 'muted', Withdrawn: 'muted' };
const uname = (db, id) => db.users[id]?.name || '—';
export function useSeen(rec) { const [seen, setSeen] = useState(rec?.version); useEffect(() => { if (seen == null && rec) setSeen(rec.version); }); return [seen ?? rec?.version, seen != null && rec && seen !== rec.version, setSeen]; }
const sameVer = (rec, v, what) => { if (v != null && rec.version !== v) throw new DomainError(`${what} changed since you opened it. The latest version is now shown; review it before deciding.`, 'stale'); };

// ---------- payments and reconciliation
export function APayments() {
  const { db, nav } = useApp(); const g = useGate(['pm']); if (g) return g;
  const open = db.recon.filter(r => r.status === 'Open').length;
  return <><PageTitle title="Payments" sub="Payment records come from simulated provider events. Staff cannot mark a payment successful." actions={<Btn onClick={() => nav({ page: 'a-recon' })}>Reconciliation queue ({open})</Btn>} />
    <AList id="payments" rows={db.payments} search={p => `${p.id} ${p.purchaseId} ${uname(db, p.buyerId)} ${p.providerRef}`} onOpen={p => nav({ page: 'a-payment', id: p.id })}
      filters={[{ k: 's', label: 'State', options: ['Awaiting payment', 'Processing', 'Paid', 'Failed', 'Cancelled', 'Expired'].map(x => [x, x]), test: (p, v) => p.state === v }, { k: 'm', label: 'Method', options: ['Card', 'Crypto', 'bKash', 'Nagad'].map(x => [x, x]), test: (p, v) => p.method === v }]}
      sorts={[{ id: 'new', label: 'Newest', fn: (a, b) => b.initiatedAt - a.initiatedAt }]}
      cols={[{ k: 'id', label: 'Payment', render: p => <b>{p.id}</b> }, { k: 'g', label: 'Purchase group', render: p => p.purchaseId }, { k: 'b', label: 'Buyer', render: p => uname(db, p.buyerId) }, { k: 'm', label: 'Method', render: p => <>{p.method} <Sim /></> }, { k: 'a', label: 'Amount', cls: 'num', render: p => <M c={p.amountC} /> }, { k: 'r', label: 'Provider ref', render: p => <code className="xs">{p.providerRef}</code> }, { k: 's', label: 'State', render: p => <Badge tone={{ Paid: 'ok', Failed: 'bad', Processing: 'warn' }[p.state] || 'muted'}>{p.state}</Badge> }, { k: 'i', label: 'Initiated', render: p => fmtDT(p.initiatedAt) }, { k: 'o', label: 'Orders', render: p => p.orderIds.join(', ') || '—' }]} /></>;
}
export function APayment() {
  const { db, staff, route, nav, perform } = useApp(); const g = useGate(['pm', route.id]); if (g) return g;
  const p = db.payments.find(x => x.id === route.id); if (!p) return <Empty title="Payment not found" />;
  const pg = db.purchases.find(x => x.id === p.purchaseId); const ords = pg.orderIds.map(id => db.orders.find(o => o.id === id)).filter(Boolean);
  return <>
    <DetailHead back={{ label: 'Payments', route: { page: 'a-payments' } }} refId={p.purchaseId} title={p.id} badges={<><Badge tone={{ Paid: 'ok', Failed: 'bad' }[p.state] || 'muted'}>{p.state}</Badge><Sim>Simulated provider</Sim></>} amounts={[['Charged', fmtMoney(p.amountC)], ['Method', p.method + (p.net ? ' · ' + p.net : '')]]}
      actions={can(db, staff, 'payments.reconcile') && <Btn size="sm" onClick={() => perform('queryPaymentStatus', { paymentId: p.id }, d => O.queryPaymentStatus(d, d.staff[staff.id], p.id), `Status re-checked: ${p.state}. Nothing changed.`)}>Query provider status</Btn>} />
    <DetailGrid main={<><Section title="Allocated orders"><Table rows={ords} onRow={o => nav({ page: 'a-order', id: o.id })} cols={[{ k: 'id', label: 'Order', render: o => <b>{o.id}</b> }, { k: 's', label: 'Seller', render: o => o.snap.storeName }, { k: 'a', label: 'Allocation', cls: 'num', render: o => money(o.total) }, { k: 'st', label: 'Fulfilment', render: o => STATUS_LABEL[o.status] }]} /><p className="small">Total {fmtMoney(p.amountC)} = {ords.map(o => money(o.total)).join(' + ')}</p></Section>
      <Section title="Provider events"><Table rows={p.events} cols={[{ k: 'op', label: 'Event', render: e => <code className="xs">{e.op}</code> }, { k: 't', label: 'Type', render: e => e.type }, { k: 'at', label: 'Received', render: e => fmtDT(e.at) }, { k: 's', label: 'Processing', render: e => <Badge tone={e.status === 'Processed' ? 'ok' : 'muted'}>{e.status}</Badge> }]} /><p className="xs muted">Repeated events are shown as ignored and never credit funds twice.</p></Section></>}
      side={<><Section title="Details"><KV items={[['Buyer', uname(db, p.buyerId)], ['Provider reference', p.providerRef], ['Initiated', fmtDT(p.initiatedAt)], ['Last verified event', fmtDT(p.lastEventAt)]]} /></Section><Section title="Timeline"><AuditTrail objects={[p.id]} /></Section></>} />
  </>;
}
export function ARecon() {
  const { db, staff, perform } = useApp(); const g = useGate(['rc']); const provider = db.scenario.provider || 'success'; const [dlg, setDlg] = useState(null); if (g) return g;
  const ok = can(db, staff, 'payments.reconcile');
  return <><PageTitle title="Reconciliation queue" sub="Unmatched receipts, duplicate notifications, late confirmations and crypto exceptions. Matching needs a verified receipt and a reason." />
    {!ok && <Notice tone="info">Your role can view but not reconcile.</Notice>}
    {db.recon.length ? db.recon.map(r => <Section key={r.id} title={<span className="row-gap">{r.id} · {r.type}<Badge tone={r.status === 'Open' ? 'warn' : 'muted'}>{r.status}</Badge></span>} action={<M c={r.amountC} />}>
      <p className="small">{r.detail}</p>{r.receipt && <KV items={[['Receipt', r.receipt.ref], ['Amount', r.receipt.amount], ['Network', r.receipt.network], ['Verified provider event', r.receipt.verified ? 'Yes (simulated)' : 'No']]} />}
      {(r.queries || []).map((q, i) => <p key={i} className="xs muted">Query by {q.by} · {fmtDT(q.at)}: {q.result}</p>)}
      {r.status === 'Open' && ok && <div className="row-gap"><Btn size="sm" onClick={() => perform('reconRetry', { reconId: r.id, outcome: provider }, d => O.reconRetry(d, staff, r.id, d.scenario.provider), 'Provider queried (simulated)')}>Retry status query</Btn>
        {r.type === 'Duplicate notification' && <Btn size="sm" onClick={() => setDlg({ dup: r })}>Confirm ignored</Btn>}
        {r.receipt && <Btn size="sm" v="primary" onClick={() => setDlg({ match: r })}>Match to purchase</Btn>}
        <Btn size="sm" v="ghost" onClick={() => setDlg({ esc: r })}>Escalate</Btn></div>}
    </Section>) : <Empty title="No reconciliation items" />}
    {dlg?.dup && <ReasonDialog title="Confirm duplicate ignored" intro="The first event was processed. Confirming records that this repeat credited nothing." confirm="Confirm" onClose={() => setDlg(null)} onSubmit={v => perform('reconIgnoreDuplicate', { reconId: dlg.dup.id, reason: v.reason }, d => O.reconIgnoreDuplicate(d, staff, dlg.dup.id, v.reason), 'Recorded as ignored')} />}
    {dlg?.match && <ReasonDialog title={`Match ${dlg.match.receipt.ref}`} intro="One receipt can fund one eligible unpaid purchase whose amount matches." confirm="Match receipt" fields={[{ k: 'pg', label: 'Purchase', type: 'select', options: db.purchases.filter(p => p.status !== 'Paid').map(p => [p.id, `${p.id} · ${uname(db, p.buyerId)} · ${money(p.total)} · ${p.status}`]), initial: db.purchases.find(p => p.status !== 'Paid')?.id }, { k: 'ref', label: 'Verified receipt reference', required: true }]} onClose={() => setDlg(null)} onSubmit={v => perform('reconMatch', { reconId: dlg.match.id, purchaseId: v.pg, receiptRef: v.ref.trim(), reason: v.reason }, d => O.reconMatch(d, staff, dlg.match.id, v.pg, v.ref.trim(), v.reason), 'Receipt matched. Orders are now paid')} />}
    {dlg?.esc && <ReasonDialog title={`Escalate ${dlg.esc.id}`} confirm="Escalate" onClose={() => setDlg(null)} onSubmit={v => perform('reconEscalate', { reconId: dlg.esc.id, reason: v.reason }, d => O.reconEscalate(d, staff, dlg.esc.id, v.reason), 'Escalated')} />}
  </>;
}

// ---------- refunds
export function ARefunds() {
  const { db, staff, route, nav, act } = useApp(); const g = useGate(['rf']); const [form, setForm] = useState(route.newFor ? { orderId: route.newFor } : null); if (g) return g;
  return <><PageTitle title="Refunds" sub="Requested → independent approval → Finance execution → provider confirmation. Approval alone never moves money." actions={<>{can(db, staff, 'refunds.request') && <Btn v="primary" icon="plus" onClick={() => setForm({})}>New refund request</Btn>}<ExportButton name="Refunds" rows={db.refunds} cols={[['Refund', r => r.id], ['Order', r => r.orderId], ['Amount USD', r => (r.amountC / 100).toFixed(2)], ['Status', r => r.status], ['Requested by', r => r.requestedBy]]} /></>} />
    <AList id="refunds" rows={db.refunds} search={r => `${r.id} ${r.orderId} ${r.caseId || ''} ${r.reason}`} onOpen={r => nav({ page: 'a-refund', id: r.id })}
      filters={[{ k: 's', label: 'Status', options: Object.keys(RF_T).map(x => [x, x]), test: (r, v) => r.status === v }]} sorts={[{ id: 'new', label: 'Newest', fn: (a, b) => b.createdAt - a.createdAt }, { id: 'amt', label: 'Amount', fn: (a, b) => b.amountC - a.amountC }]}
      empty={<Empty icon="refresh" title="No refund requests" />}
      cols={[{ k: 'id', label: 'Refund', render: r => <b>{r.id}</b> }, { k: 'o', label: 'Order / case', render: r => <span className="small">{r.orderId}{r.caseId ? ' · ' + r.caseId : ''}</span> }, { k: 'a', label: 'Amount', cls: 'num', render: r => <M c={r.amountC} /> }, { k: 'rq', label: 'Requested by', render: r => <span className="small">{r.requestedBy}</span> }, { k: 'ap', label: 'Approval', render: r => { const a = db.approvals.find(x => x.id === r.approvalId); return a ? <Badge tone={AP_T[a.status]}>{a.status}</Badge> : '—'; } }, { k: 's', label: 'Status', render: r => <Badge tone={RF_T[r.status]} dot>{r.status}</Badge> }, { k: 'c', label: 'Created', render: r => rel(r.createdAt) }]} />
    {form && <RefundForm init={form} onClose={() => setForm(null)} />}
  </>;
}
function RefundForm({ init, onClose }) {
  const { db, staff, perform, nav } = useApp();
  const paid = db.orders.filter(o => o.payment.status === 'Paid');
  const [oid, setOid] = useState(init.orderId || paid[0]?.id); const [amt, setAmt] = useState(''); const [reason, setReason] = useState(''); const [cid, setCid] = useState(''); const [err, setErr] = useState('');
  const o = db.orders.find(x => x.id === oid); const cases = db.cases.filter(c => c.orderId === oid);
  const aC = Math.round(+amt * 100); const lim = S(db).financeRefundLimitC;
  return <Modal title="New refund request" onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>Cancel</Btn><Btn v="primary" onClick={async () => { const r = await perform('requestRefund', { orderId: oid, amountC: aC, reason, caseId: cid || null }, d => ({ refundId: requestRefund(d, d.staff[staff.id], { orderId: oid, amountC: aC, reason, caseId: cid || null }).id }), 'Refund requested. Routed for independent approval', { inline: true }); if (r.ok) { onClose(); nav({ page: 'a-refund', id: r.value.refundId }); } else setErr(r.error.message); }}>Submit request</Btn></>}>
    <Field label="Order"><select value={oid} onChange={e => setOid(e.target.value)}>{paid.map(x => <option key={x.id} value={x.id}>{x.id} · {x.snap.storeName} · {money(x.total)}</option>)}</select></Field>
    {o && <KV items={[['Original paid', fmtMoney(paidC(o))], ['Previous refunds', fmtMoney(refundedC(db, o))], ['Reserved by pending requests', fmtMoney(reservedRefundC(db, o))], ['Remaining refundable', <b>{fmtMoney(refundableC(db, o))}</b>], ['Affected charges', 'Product subtotal only. Buyer, payment and payout fees are zero in this demo.']]} />}
    <div className="form-grid"><Field label="Amount (USD)" required hint={aC > lim ? `Above ${fmtMoney(lim)}: needs a Super Admin approver` : `Up to ${fmtMoney(lim)} can be approved by another Finance Admin`}><input type="number" value={amt} onChange={e => setAmt(e.target.value)} /></Field><Field label="Currency"><select disabled><option>USD</option></select></Field></div>
    {cases.length > 0 && <Field label="Case reference"><select value={cid} onChange={e => setCid(e.target.value)}><option value="">None</option>{cases.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}</select></Field>}
    <Field label="Reason" required><textarea rows="2" value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {aC > 0 && o && <p className="small">Commission reversal {fmtMoney(Math.round(aC * o.commissionRate))}, seller reversal {fmtMoney(aC - Math.round(aC * o.commissionRate))} (on confirmation only).</p>}
    {err && <p className="ferr" role="alert">{err}</p>}</Modal>;
}
export function ARefund() {
  const { db, staff, route, nav, perform } = useApp(); const g = useGate(['rf', route.id]); const r = db.refunds.find(x => x.id === route.id); const [v, stale, setSeen] = useSeen(r); const [dlg, setDlg] = useState(null); if (g) return g;
  if (!r) return <Empty title="Refund not found" />;
  const o = db.orders.find(x => x.id === r.orderId); const apr = db.approvals.find(a => a.id === r.approvalId); const hist = db.approvals.filter(a => a.ref === r.id);
  const why = apr && apr.status === 'Pending' ? approvalCheck(db, staff, apr) : null;
  const run = async (name, args, fn, m) => { const x = await perform(name, args, fn, m); if (!x.ok && x.error.code === 'stale') setSeen(r.version); else if (x.ok) setSeen(null); return x; };
  const comm = Math.round(r.amountC * o.commissionRate); const provider = db.scenario.provider || 'success';
  const ev = db.events.filter(e => e.ref === r.id);
  return <>
    <DetailHead back={{ label: 'Refunds', route: { page: 'a-refunds' } }} refId={`${r.orderId}${r.caseId ? ' · ' + r.caseId : ''}`} title={r.id} badges={<><Badge tone={RF_T[r.status]} dot>{r.status}</Badge>{apr && <Badge tone={AP_T[apr.status]}>Approval {apr.status}</Badge>}<Badge tone="muted">Version {r.version}</Badge></>}
      amounts={[['Refund', fmtMoney(r.amountC)], ['Commission reversal', fmtMoney(comm)], ['Seller reversal', fmtMoney(r.amountC - comm)]]}
      actions={<>{apr?.status === 'Pending' && <><Btn v="primary" size="sm" onClick={() => setDlg('approve')}>Approve</Btn><Btn size="sm" onClick={() => setDlg('changes')}>Request changes</Btn><Btn size="sm" v="ghost" onClick={() => setDlg('reject')}>Reject</Btn></>}
        {['Approved', 'Failed'].includes(r.status) && <Btn v="primary" size="sm" onClick={() => run('executeRefund', { refundId: r.id, version: v }, d => executeRefund(d, d.staff[staff.id], r.id, v), r.status === 'Failed' ? 'Retry sent with the same operation reference' : 'Sent to provider (simulated). Processing')}>{r.status === 'Failed' ? 'Retry execution' : 'Execute refund'}</Btn>}
        {['Requested', 'Approved', 'Changes requested'].includes(r.status) && can(db, staff, 'refunds.request') && <Btn size="sm" v="ghost" onClick={() => setDlg('edit')}>Change amount</Btn>}</>} />
    {stale && <Notice tone="warn" title="This refund changed" action={<Btn size="sm" onClick={() => setSeen(r.version)}>Review latest</Btn>}>It was updated after you opened it. Actions use the version you reviewed and will be refused until you refresh.</Notice>}
    {why && <Notice tone="warn" title="You cannot approve this request">{why}</Notice>}
    {['Processing', 'Reconciliation required'].includes(r.status) && <Notice tone="warn" title={r.status === 'Processing' ? 'Waiting for the provider' : 'Unknown provider result'} action={<div className="row-gap"><Btn size="sm" v="primary" onClick={() => run('refundProviderEvent', { refundId: r.id, outcome: provider }, d => refundProviderEvent(d, d.staff[staff.id], r.id, d.scenario.provider), 'Provider event applied')}>{r.status === 'Processing' ? 'Deliver provider result' : 'Query provider'} ({provider})</Btn></div>}>Uses the outcome set in the demo toolbar (success, failure or unknown). <Sim>Simulated provider</Sim> Duplicate execution is blocked while this is outstanding.</Notice>}
    {['Refunded', 'Partially refunded'].includes(r.status) && <Notice tone="ok" title="Refund confirmed" action={<Btn size="sm" onClick={() => run('refundProviderEvent', { refundId: r.id, outcome: 'success' }, d => refundProviderEvent(d, d.staff[staff.id], r.id, 'success'), 'Duplicate event ignored. Totals unchanged')}>Replay provider event</Btn>}>Replaying the same provider event shows it is ignored and totals do not change.</Notice>}
    <DetailGrid main={<DTabs tabs={[
      { id: 'ov', label: 'Overview', body: <><Section title="Amounts"><KV items={[['Order paid', fmtMoney(paidC(o))], ['Refunded before this', fmtMoney(refundedC(db, o) - (['Refunded', 'Partially refunded'].includes(r.status) ? r.amountC : 0))], ['Reserved by other pending refunds', fmtMoney(reservedRefundC(db, o, r.id))], ['Remaining refundable (excluding this)', fmtMoney(refundableC(db, o, r.id))], ['Seller allocation affected', `${o.snap.storeName} only (${o.id})`], ['Rounding', 'Commission reversal rounded half up to the cent']]} /></Section>
        <Section title="Request"><KV items={[['Reason', r.reason], ['Requested by', r.requestedBy], ['Created', fmtDT(r.createdAt)], ['Operation reference', <code>{r.opRef}</code>], ['Required approver', apr?.requiredAuthority]]} /></Section></> },
      { id: 'ap', label: 'Approvals', count: hist.length, body: <Section>{hist.map(a => <div key={a.id} className="restr"><div className="row-gap"><b className="small">{a.id}</b><Badge tone={AP_T[a.status]}>{a.status}</Badge><M c={a.amountC} /></div><span className="xs muted">Requested by {a.requester} · {fmtDT(a.createdAt)}{a.approverId ? ` · decided by ${db.staff[a.approverId]?.name}` : ''}</span>{a.comments.map((c, i) => <p key={i} className="xs">{c.by}: {c.text}</p>)}</div>)}</Section> },
      { id: 'att', label: 'Provider attempts', count: r.attempts.length, body: <Section><Table rows={r.attempts.map((a, i) => ({ ...a, id: i }))} empty={<p className="muted small">Not sent yet.</p>} cols={[{ k: 'op', label: 'Operation', render: a => <code className="xs">{a.op}</code> }, { k: 'at', label: 'Sent', render: a => fmtDT(a.at) }, { k: 'by', label: 'By', render: a => a.by }, { k: 'r', label: 'Result', render: a => a.result }]} />{ev.map(e => <p key={e.id} className="xs muted">{fmtDT(e.at)} · {e.op}: {e.result}</p>)}</Section> },
      { id: 'tl', label: 'Timeline', body: <Section><AuditTrail objects={[r.id, r.approvalId]} /></Section> },
    ]} />} side={<><Section title="Linked"><KV items={[['Order', <button className="linkbtn" onClick={() => nav({ page: 'a-order', id: o.id })}>{o.id}</button>], r.caseId && ['Case', <button className="linkbtn" onClick={() => nav({ page: 'a-case', id: r.caseId })}>{r.caseId}</button>], ['Buyer', uname(db, o.buyerId)], ['Seller', o.snap.storeName], ['Your limit', limitFor(db, staff, 'refunds') === Infinity ? 'No limit (Super Admin)' : fmtMoney(limitFor(db, staff, 'refunds'))]]} /></Section><SidePanel k={key('refund', r.id)} label={r.id} eligiblePerm="refunds.approve" /></>} />
    {['approve', 'reject', 'changes'].includes(dlg) && <ReasonDialog title={{ approve: 'Approve refund', reject: 'Reject refund', changes: 'Request changes' }[dlg]} intro={`${fmtMoney(r.amountC)} on ${o.id}. Approval reserves the amount but does not send money.`} danger={dlg === 'reject'} confirm={{ approve: 'Approve', reject: 'Reject', changes: 'Request changes' }[dlg]} onClose={() => setDlg(null)} onSubmit={x => run('decideApproval', { approvalId: apr.id, decision: dlg, reason: x.reason, version: apr.version, refVersion: v }, d => { sameVer(d.refunds.find(y => y.id === r.id), v, 'This refund'); decideApproval(d, d.staff[staff.id], apr.id, dlg, x.reason, apr.version); }, 'Decision recorded')} />}
    {dlg === 'edit' && <ReasonDialog title="Change refund amount" intro="Changing the amount invalidates any existing approval and creates a new version for review." fields={[{ k: 'amt', label: 'New amount (USD)', type: 'number', required: true, initial: r.amountC / 100 }]} confirm="Save and resubmit" onClose={() => setDlg(null)} onSubmit={x => run('editRefundAmount', { refundId: r.id, amountC: Math.round(+x.amt * 100), reason: x.reason, version: v }, d => editRefundAmount(d, d.staff[staff.id], r.id, Math.round(+x.amt * 100), x.reason, v), 'Amount changed. Earlier approval invalidated')} />}
  </>;
}

// ---------- payouts
export function APayouts() {
  const { db, nav } = useApp(); const g = useGate(['po']); if (g) return g;
  const rows = db.payouts.map(p => ({ ...p, store: db.stores[p.storeId].name, apr: db.approvals.find(a => a.id === p.approvalId) }));
  return <><PageTitle title="Payouts" sub="Seller requests reserve funds. A different staff member approves; Finance executes a simulated transfer." actions={<ExportButton name="Payouts" rows={rows} cols={[['Payout', r => r.id], ['Seller', r => r.store], ['Amount USD', r => (r.amountC / 100).toFixed(2)], ['Status', r => r.status], ['Destination', r => r.dest]]} />} />
    <AList id="payouts" rows={rows} search={p => `${p.id} ${p.store} ${p.dest}`} onOpen={p => nav({ page: 'a-payout', id: p.id })}
      filters={[{ k: 's', label: 'Status', options: ['Awaiting approval', 'Approved', 'Processing', 'Paid', 'Failed', 'Cancelled', 'Rejected', 'Reconciliation required'].map(x => [x, x]), test: (p, v) => p.status === v }]} sorts={[{ id: 'new', label: 'Newest', fn: (a, b) => b.requestedAt - a.requestedAt }]}
      cols={[{ k: 'id', label: 'Payout', render: p => <b>{p.id}</b> }, { k: 's', label: 'Seller', render: p => p.store }, { k: 'a', label: 'Amount', cls: 'num', render: p => <M c={p.amountC} /> }, { k: 'm', label: 'Method', render: p => p.method }, { k: 'd', label: 'Destination', render: p => <span className="small">{p.dest}</span> }, { k: 'r', label: 'Requested', render: p => fmtDT(p.requestedAt) }, { k: 'ap', label: 'Approval', render: p => p.apr ? <Badge tone={AP_T[p.apr.status]}>{p.apr.status}</Badge> : '—' }, { k: 'st', label: 'Transfer', render: p => <Badge tone={PO_T[p.status]} dot>{p.status}</Badge> }, { k: 'pr', label: 'Provider ref', render: p => p.providerRef ? <code className="xs">{p.providerRef}</code> : '—' }]} /></>;
}
export function APayout() {
  const { db, staff, route, nav, perform, payoutMode, refresh, toast } = useApp(); const g = useGate(['po', route.id]); const p = db.payouts.find(x => x.id === route.id); const [v, stale, setSeen] = useSeen(p); const [dlg, setDlg] = useState(null); if (g) return g;
  if (!p) return <Empty title="Payout not found" />;
  const st = db.stores[p.storeId]; const b = storeBuckets(db, p.storeId); const apr = db.approvals.find(a => a.id === p.approvalId); const hist = db.approvals.filter(a => a.ref === p.id);
  const why = apr && apr.status === 'Pending' ? approvalCheck(db, staff, apr) : null;
  const run = async (name, args, fn, m) => { const x = await perform(name, args, fn, m); if (!x.ok && x.error.code === 'stale') setSeen(p.version); else if (x.ok) setSeen(null); return x; };
  const provider = db.scenario.provider || 'success';
  // A real transfer through NOWPayments: a crypto destination with payouts connected.
  const live = apiEnabled && payoutMode === 'nowpayments' && p.method === 'Crypto' && !!p.destAddress; const [checking, setChecking] = useState(false);
  const askProvider = async () => { setChecking(true); try { const r = await api.payoutStatus(p.id); await refresh(); toast(`NOWPayments reports: ${r.providerStatus}`, 'info'); } catch (e) { toast(e.message, 'bad'); } setChecking(false); };
  const methods = db.payoutMethods[p.storeId] || []; const entries = db.ledger.filter(e => e.store === p.storeId).sort((a, c) => c.at - a.at).slice(0, 12);
  return <>
    <DetailHead back={{ label: 'Payouts', route: { page: 'a-payouts' } }} refId={st.name} title={p.id} badges={<><Badge tone={PO_T[p.status]} dot>{p.status}</Badge>{apr && <Badge tone={AP_T[apr.status]}>Approval {apr.status}</Badge>}<Badge tone="muted">Version {p.version}</Badge></>}
      amounts={[['Amount', fmtMoney(p.amountC)], ['Fee', fmtMoney(p.feeC)], ['Net receipt', fmtMoney(p.amountC - p.feeC)]]}
      actions={<>{apr?.status === 'Pending' && <><Btn v="primary" size="sm" onClick={() => setDlg('approve')}>Approve</Btn><Btn size="sm" v="ghost" onClick={() => setDlg('reject')}>Reject</Btn></>}
        {p.status === 'Approved' && live && <Btn v="primary" size="sm" disabled={!can(db, staff, 'payouts.execute')} onClick={() => setDlg('send')}>Send with NOWPayments</Btn>}
        {p.status === 'Approved' && !live && <Btn v="primary" size="sm" onClick={() => run('executePayout', { payoutId: p.id, version: v }, d => executePayout(d, d.staff[staff.id], p.id, v), 'Transfer sent (simulated). Funds stay reserved while processing')}>Execute transfer</Btn>}
        {['Awaiting approval', 'Approved', 'Changes requested'].includes(p.status) && can(db, staff, 'payouts.approve') && <Btn size="sm" v="ghost" onClick={() => setDlg('cancel')}>Cancel payout</Btn>}</>} />
    {stale && <Notice tone="warn" title="This payout changed" action={<Btn size="sm" onClick={() => setSeen(p.version)}>Review latest</Btn>}>Updated after you opened it (for example a destination change). Review before acting.</Notice>}
    {why && <Notice tone="warn" title="You cannot approve this request">{why}</Notice>}
    {live && p.status === 'Processing' && p.awaitingCode && <Notice tone="warn" title="Waiting for the two-factor code" action={<Btn size="sm" v="primary" onClick={() => setDlg('code')}>Enter code</Btn>}>The transfer was created at NOWPayments but not confirmed. Without a valid code NOWPayments rejects it after one hour and the funds return to the seller's available balance.</Notice>}
    {p.sentVia && p.status === 'Processing' && !p.awaitingCode && <Notice tone="info" title={`Transfer in progress at ${p.sentVia}`} action={<Btn size="sm" disabled={checking} onClick={askProvider}>{checking ? 'Checking…' : 'Check status'}</Btn>}>Batch <code>{p.providerBatch}</code>. The result arrives by itself when the network confirms the transfer. Funds stay reserved until then.</Notice>}
    {p.sentVia && p.status === 'Reconciliation required' && <Notice tone="bad" title="Unknown transfer result. Funds remain reserved" action={<span className="row-gap">{p.providerBatch && <Btn size="sm" disabled={checking} onClick={askProvider}>{checking ? 'Checking…' : 'Check status'}</Btn>}<Btn size="sm" v="primary" disabled={!can(db, staff, 'payments.reconcile')} onClick={() => setDlg('reconcile')}>Reconcile by hand</Btn></span>}>{p.providerBatch ? `Look at batch ${p.providerBatch} in the NOWPayments dashboard.` : `NOWPayments did not confirm creating this transfer. Look in the NOWPayments dashboard for a payout described "Crateline payout ${p.id}".`} Do not send it again until it is settled.</Notice>}
    {!p.sentVia && ['Processing', 'Reconciliation required'].includes(p.status) && <Notice tone="warn" title={p.status === 'Processing' ? 'Transfer in progress' : 'Unknown transfer result. Funds remain reserved'} action={<Btn size="sm" v="primary" onClick={() => run('payoutProviderEvent', { payoutId: p.id, outcome: provider }, d => payoutProviderEvent(d, d.staff[staff.id], p.id, d.scenario.provider), 'Provider result applied')}>{p.status === 'Processing' ? 'Deliver provider result' : 'Reconcile with provider'} ({provider})</Btn>}>Outcome comes from the demo toolbar. <Sim>Simulated transfer</Sim> A retry cannot send the same reserved amount twice.</Notice>}
    {!apiEnabled && ['Awaiting approval', 'Approved'].includes(p.status) && methods.length > 1 && <Notice tone="info" title="Demo: seller changes destination" action={<Btn size="sm" onClick={() => run(null, null, d => changePayoutDestination(d, { name: db.users[st.ownerId].name + ' (seller, simulated)' }, p.id, methods.find(m => m.id !== p.methodId).id), 'Destination changed. Earlier approval invalidated')}>Simulate destination change</Btn>}>Staff cannot replace a destination. A seller change invalidates the approval and needs a new review.</Notice>}
    <DetailGrid main={<DTabs tabs={[
      { id: 'ov', label: 'Overview', body: <><Section title="Seller balance (from ledger)"><div className="pv-bal">{[['Available', b.available], ['Pending earnings', b.pending], ['Dispute holds', b.held], ['Payout reservations', b.reserved], ['Paid out (history)', b.paidOut]].map(([k, c]) => <div key={k}><span className="xs muted">{k}</span><b>{fmtMoney(c)}</b></div>)}</div><p className="xs muted">Holds and reservations cannot be withdrawn. Paid-out funds are history, not balance.</p></Section>
        <Section title="Destination snapshot"><KV items={[['Method', p.method], ['Destination', p.destAddress ? <code className="addr">{p.destAddress}</code> : p.dest + ' (masked)'], ...(p.destNet ? [['Network', p.destNet]] : []), ['Verification', p.destVerified ? 'Verified' : 'Not verified'], ['Provider', p.provider], ['Operation reference', <code>{p.opRef}</code>], ['Required approver', apr?.requiredAuthority]]} /></Section></> },
      { id: 'ap', label: 'Approvals', count: hist.length, body: <Section>{hist.map(a => <div key={a.id} className="restr"><div className="row-gap"><b className="small">{a.id}</b><Badge tone={AP_T[a.status]}>{a.status}</Badge></div><span className="xs muted">{a.title} · {fmtDT(a.createdAt)}{a.approverId ? ` · ${db.staff[a.approverId]?.name}` : ''}</span>{a.comments.map((c, i) => <p key={i} className="xs">{c.by}: {c.text}</p>)}</div>)}</Section> },
      { id: 'tx', label: 'Transactions', body: <Table rows={entries} cols={[{ k: 'id', label: 'Entry', render: e => <code className="xs">{e.id}</code> }, { k: 'k', label: 'Type', render: e => e.kind }, { k: 'm', label: 'Movement', render: e => `${e.from === 'ext' ? 'new' : e.from} → ${e.to}` }, { k: 'r', label: 'Ref', render: e => e.order || e.payout || '' }, { k: 'a', label: 'Amount', cls: 'num', render: e => <M c={e.amt} /> }]} /> },
      { id: 'tl', label: 'Timeline', body: <Section>{p.attempts.map((a, i) => <p key={i} className="small">{fmtDT(a.at)} · {a.by} · {a.op}: {a.result}</p>)}<AuditTrail objects={[p.id, ...hist.map(a => a.id)]} /></Section> },
    ]} />} side={<SidePanel k={key('payout', p.id)} label={p.id} eligiblePerm="payouts.approve" />} />
    {['approve', 'reject'].includes(dlg) && <ReasonDialog title={dlg === 'approve' ? 'Approve payout' : 'Reject payout'} intro={dlg === 'approve' ? 'Approval keeps the reservation. It does not transfer money.' : 'Rejection releases the reservation to available (no transfer has started).'} danger={dlg === 'reject'} confirm={dlg === 'approve' ? 'Approve' : 'Reject'} onClose={() => setDlg(null)} onSubmit={x => run('decideApproval', { approvalId: apr.id, decision: dlg, reason: x.reason, version: apr.version, refVersion: v }, d => { sameVer(d.payouts.find(y => y.id === p.id), v, 'This payout'); decideApproval(d, d.staff[staff.id], apr.id, dlg, x.reason, apr.version); }, 'Decision recorded')} />}
    {(dlg === 'send' || dlg === 'code') && <CodeDialog p={p} first={dlg === 'send'} version={v} onClose={() => setDlg(null)} />}
    {dlg === 'reconcile' && <ReasonDialog title={`Reconcile ${p.id}`} intro="Record what the NOWPayments dashboard shows for this transfer. Paid moves the reserved funds to paid out; not sent returns them to the seller's available balance. This cannot be undone." confirm="Record result" danger fields={[{ k: 'outcome', label: 'What NOWPayments shows', type: 'select', options: [['not_sent', 'Not sent: no transfer exists'], ['paid', 'Paid: the transfer completed']], required: true, initial: 'not_sent' }, { k: 'ref', label: 'Transaction hash or payout id (required for paid)' }]} onClose={() => setDlg(null)} onSubmit={x => run('reconcilePayout', { payoutId: p.id, outcome: x.outcome, ref: x.ref, reason: x.reason }, d => reconcilePayout(d, d.staff[staff.id], p.id, x.outcome, x.ref, x.reason), 'Payout reconciled')} />}
    {dlg === 'cancel' && <ReasonDialog title="Cancel payout" danger confirm="Cancel payout" onClose={() => setDlg(null)} onSubmit={x => run('cancelPayout', { payoutId: p.id, reason: x.reason }, d => cancelPayout(d, d.staff[staff.id], p.id, x.reason, true), 'Payout cancelled. Funds released')} />}
  </>;
}

// Sends a real transfer, or confirms one already created, with the provider's two-factor code.
function CodeDialog({ p, first, version, onClose }) {
  const { refresh, toast } = useApp(); const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function go() {
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return setErr('Enter the 6-digit code.');
    setBusy(true); setErr('');
    try { await (first ? api.sendPayout(p.id, version, code) : api.confirmPayout(p.id, code)); await refresh(); toast('Transfer confirmed at NOWPayments. Funds stay reserved until the network confirms it.'); onClose(); }
    catch (e) { await refresh().catch(() => { }); setBusy(false); setErr(e.message); }
  }
  return <Modal title={first ? `Send ${p.id} with NOWPayments` : `Confirm ${p.id}`} onClose={onClose} footer={<><Btn v="ghost" onClick={onClose}>{err && !busy ? 'Close' : 'Cancel'}</Btn><Btn v="primary" disabled={busy} onClick={go}>{busy ? 'Sending…' : first ? `Send ${fmtMoney(p.amountC - p.feeC)}` : 'Confirm transfer'}</Btn></>}>
    {first && <Notice tone="warn" title="This sends real money and cannot be reversed">{fmtMoney(p.amountC - p.feeC)} in {p.destNet} to <code className="addr">{p.destAddress}</code>. Check the address against the approved destination before sending.</Notice>}
    <Field label="NOWPayments two-factor code" required hint="The 6-digit code from the authenticator app linked to the NOWPayments account" error={err}><input inputMode="numeric" autoComplete="one-time-code" maxLength="7" value={code} onChange={e => setCode(e.target.value)} /></Field>
  </Modal>;
}

// ---------- approvals
export function AApprovals() {
  const { db, nav } = useApp(); const g = useGate(['ap']); if (g) return g;
  const cat = a => ['refund', 'payout'].includes(a.type) ? 'financial' : ['role', 'staffRole'].includes(a.type) ? 'staff' : a.type === 'policy' ? 'content' : 'configuration';
  return <><PageTitle title="Approvals" sub="A requester can never approve their own request. Authority and thresholds are rechecked at decision time." />
    <AList id="approvals" rows={db.approvals} search={a => `${a.id} ${a.title} ${a.requester}`} onOpen={a => nav({ page: 'sa-approval', id: a.id })}
      filters={[{ k: 'c', label: 'Type', options: [['financial', 'Financial requests'], ['staff', 'Staff authority'], ['configuration', 'Configuration'], ['content', 'Content publication']], test: (a, v) => cat(a) === v }, { k: 's', label: 'State', options: Object.keys(AP_T).map(x => [x, x]), test: (a, v) => a.status === v }]}
      sorts={[{ id: 'new', label: 'Newest', fn: (a, b) => b.createdAt - a.createdAt }]}
      cols={[{ k: 'id', label: 'Request', render: a => <b>{a.id}</b> }, { k: 't', label: 'Type', render: a => a.type }, { k: 'ti', label: 'Subject', render: a => <span className="small">{a.title}</span> }, { k: 'rq', label: 'Requester', render: a => <span className="small">{a.requester}</span> }, { k: 'a', label: 'Amount', cls: 'num', render: a => a.amountC ? <M c={a.amountC} /> : '—' }, { k: 'au', label: 'Required authority', render: a => <span className="xs">{a.requiredAuthority}</span> }, { k: 'c', label: 'Created', render: a => rel(a.createdAt) }, { k: 'e', label: 'Expires', render: a => a.status === 'Pending' ? rel(a.expiresAt) : '—' }, { k: 's', label: 'State', render: a => <Badge tone={AP_T[a.status]} dot>{a.status}</Badge> }]} /></>;
}
export function AApproval() {
  const { db, staff, route, nav, perform } = useApp(); const g = useGate(['ap', route.id]); const a = db.approvals.find(x => x.id === route.id); const [v, stale, setSeen] = useSeen(a); const [dlg, setDlg] = useState(null); if (g) return g;
  if (!a) return <Empty title="Approval not found" />;
  const why = a.status === 'Pending' ? approvalCheck(db, staff, a) : null;
  const linkR = a.type === 'refund' ? { page: 'a-refund', id: a.ref } : a.type === 'payout' ? { page: 'a-payout', id: a.ref } : a.type === 'setting' ? { page: 'sa-settings' } : a.type === 'role' ? { page: 'sa-staff' } : a.type === 'integration' ? { page: 'sa-integrations' } : null;
  const run = async (name, args, fn, m) => { const x = await perform(name, args, fn, m); if (!x.ok && x.error.code === 'stale') setSeen(a.version); else if (x.ok) setSeen(null); return x; };
  return <>
    <DetailHead back={{ label: 'Approvals', route: { page: 'sa-approvals' } }} refId={a.ref} title={a.title} badges={<><Badge tone={AP_T[a.status]} dot>{a.status}</Badge><Badge tone="muted">{a.id} · v{a.version}</Badge></>} amounts={[a.amountC && ['Amount', fmtMoney(a.amountC)], ['Required', a.requiredAuthority]]}
      actions={a.status === 'Pending' && <><Btn v="primary" size="sm" onClick={() => setDlg('approve')}>Approve</Btn><Btn size="sm" onClick={() => setDlg('changes')}>Request changes</Btn><Btn size="sm" v="ghost" onClick={() => setDlg('reject')}>Reject</Btn></>} />
    {stale && <Notice tone="warn" title="Request changed" action={<Btn size="sm" onClick={() => setSeen(a.version)}>Review latest</Btn>}>Version {a.version} is now shown.</Notice>}
    {why && <Notice tone="warn" title="Not available to you">{why} If you try anyway, the attempt is blocked and recorded.</Notice>}
    {['Invalidated', 'Expired'].includes(a.status) && <Notice tone="info">{a.status === 'Invalidated' ? 'This approval no longer applies because the request changed. Review the newer version.' : 'Expired requests cannot be executed.'}</Notice>}
    <DetailGrid main={<><Section title="Requested change"><div className="diff"><div><span className="xs muted">Before</span><p>{a.before || '—'}</p></div><Icon n="arrow" /><div><span className="xs muted">After</span><p><b>{a.after || '—'}</b></p></div></div><KV items={[['Reason', a.reason], ['Requester', a.requester], ['Created', fmtDT(a.createdAt)], ['Expires', fmtDT(a.expiresAt)], a.supersedes && ['Supersedes', a.supersedes], ['Linked record', linkR ? <button className="linkbtn" onClick={() => nav(linkR)}>{a.ref}</button> : a.ref]]} />
      {a.payload?.diff && <><h3 className="sub-h">Permission changes</h3><p className="small">Added: {a.payload.diff.added.join(', ') || 'none'}<br />Removed: {a.payload.diff.removed.join(', ') || 'none'}</p></>}</Section>
      <Section title="Comments and decisions">{a.comments.length ? a.comments.map((c, i) => <p key={i} className="small"><b>{c.by}</b> · {fmtDT(c.at)}: {c.text}</p>) : <p className="muted small">None yet.</p>}</Section></>}
      side={<Section title="History"><AuditTrail objects={[a.id, a.ref]} /></Section>} />
    {['approve', 'reject', 'changes'].includes(dlg) && <ReasonDialog title={{ approve: 'Approve', reject: 'Reject', changes: 'Request changes' }[dlg] + ' ' + a.id} danger={dlg === 'reject'} confirm={{ approve: 'Approve', reject: 'Reject', changes: 'Request changes' }[dlg]} onClose={() => setDlg(null)} onSubmit={x => run('decideApproval', { approvalId: a.id, decision: dlg, reason: x.reason, version: v }, d => decideApproval(d, d.staff[staff.id], a.id, dlg, x.reason, v), 'Decision recorded')} />}
  </>;
}

// ---------- operational reports
export function AReports() {
  const { db, staff, nav } = useApp(); const g = useGate(['rp']); const [range, setRange] = useState(30); if (g) return g;
  const since = now() - range * DAY; const fin = can(db, staff, 'reports.financial');
  const vers = db.verifications.flatMap(v => v.decisions.filter(x => ['Approve', 'Reject', 'Request information'].includes(x.decision)).map(x => ({ v, x }))).filter(({ x }) => x.at >= since);
  const turn = vers.length ? (vers.reduce((a, { v, x }) => a + (x.at - v.submittedAt), 0) / vers.length / HOUR).toFixed(1) + ' h' : 'No decisions in period';
  const casesP = db.cases.filter(c => c.openedAt >= since); const out = {}; casesP.forEach(c => { const k = c.remedy?.type || (c.status === 'Escalated' ? 'Escalated, undecided' : 'Undecided'); out[k] = (out[k] || 0) + 1; });
  const paidOrders = db.orders.filter(o => o.payment.status === 'Paid' && o.placedAt >= since);
  const rf = db.refunds.filter(r => r.createdAt >= since); const pxs = db.payouts.filter(p => p.requestedAt >= since && ['Failed', 'Reconciliation required', 'Rejected'].includes(p.status));
  const tk = db.tickets.filter(t => t.at >= since); const answered = tk.filter(t => t.thread.some(m => m.from === 'staff' && m.kind === 'public'));
  const resp = answered.length ? (answered.reduce((a, t) => a + (t.thread.find(m => m.from === 'staff' && m.kind === 'public').at - t.at), 0) / answered.length / HOUR).toFixed(1) + ' h' : 'No replies in period';
  const catAct = db.audit.filter(a => a.at >= since && a.action.startsWith('Listing ')).length;
  const rep = (title, value, def, drill, show = true) => show && <div className="report"><span className="xs muted">{title}</span><b>{value}</b><span className="xs">{def}</span>{drill && <button className="linkbtn xs" onClick={() => nav(drill)}>View records</button>}</div>;
  return <><PageTitle title="Operational reports" sub={`Period: last ${range} days to ${fmtDT(now())}. Time zone ${tzName}. Currency USD. Calculated from stored records.`} actions={<><Seg label="Period" value={range} onChange={setRange} options={[{ id: 7, label: '7 d' }, { id: 30, label: '30 d' }, { id: 90, label: '90 d' }]} /><ExportButton name="Operational report" rows={[{ id: 1 }]} cols={[['Period days', () => range], ['Paid orders', () => paidOrders.length], ['Purchase groups', () => new Set(paidOrders.map(o => o.purchaseRef)).size], ['Cases opened', () => casesP.length], ['Tickets', () => tk.length]]} /></>} />
    <div className="report-grid">
      {rep('Queue backlog (now)', db.cases.filter(c => !['Resolved', 'Closed'].includes(c.status)).length + db.tickets.filter(t => !['Resolved', 'Closed'].includes(t.status)).length + db.listings.filter(l => l.availability === 'Pending review').length + db.verifications.filter(v => v.state === 'Verification pending').length, 'Open cases + open tickets + listings and sellers awaiting review. Current count, not period.', { page: 'a-queue' })}
      {rep('Overdue orders (now)', db.orders.filter(isOverdue).length, `of ${db.orders.filter(o => ['paid', 'preparing', 'partial', 'awaiting_info'].includes(o.status)).length} orders in fulfilment`, { page: 'a-orders' }, can(db, staff, 'orders.view'))}
      {rep('Paid orders', `${paidOrders.length} orders`, `in ${new Set(paidOrders.map(o => o.purchaseRef)).size} purchase groups. Unpaid attempts excluded (${db.orders.filter(o => o.payment.status !== 'Paid' && o.placedAt >= since).length}).`, { page: 'a-orders' }, can(db, staff, 'orders.view'))}
      {rep('Seller onboarding turnaround', turn, `Average submission-to-decision time over ${vers.length} decisions`, { page: 'a-sellers' }, can(db, staff, 'sellers.view'))}
      {rep('Dispute outcomes', Object.entries(out).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'No cases', `${casesP.length} cases opened; dispute rate ${paidOrders.length ? Math.round(100 * casesP.length / paidOrders.length) : 0}% of ${paidOrders.length} paid orders`, { page: 'a-cases' }, can(db, staff, 'cases.view'))}
      {rep('Refunds', `${fmtMoney(rf.filter(r => ['Refunded', 'Partially refunded'].includes(r.status)).reduce((a, r) => a + r.amountC, 0))} confirmed`, `${rf.length} requests; ${rf.filter(r => !['Refunded', 'Partially refunded', 'Rejected'].includes(r.status)).length} pending (attempts, not completed)`, { page: 'a-refunds' }, fin)}
      {rep('Payout exceptions', pxs.length, 'Failed, rejected or unknown-result payouts in period', { page: 'a-payouts' }, fin)}
      {rep('Support first response', resp, `Average over ${answered.length} of ${tk.length} tickets with a public reply`, { page: 'a-support' }, can(db, staff, 'support.view'))}
      {rep('Catalog review activity', catAct, 'Listing moderation decisions recorded in audit history', { page: 'a-products' }, can(db, staff, 'catalog.view'))}
    </div>
    {!fin && <Notice tone="info">Financial reports need the Financial reports permission.</Notice>}</>;
}
export function AActivity() {
  const { db, more, loadMore } = useApp(); const g = useGate(['ac']); if (g) return g;
  const rows = db.audit.filter(a => !a.sensitive);
  return <><PageTitle title="Activity" sub="Administrative history you are permitted to see. Sensitive evidence access is listed under Security and audit." />
    <AList id="activity" rows={rows} search={a => `${a.actor} ${a.action} ${a.object} ${a.reason}`} pageSize={12}
      filters={[{ k: 'r', label: 'Role', options: [...new Set(rows.map(a => a.role))].map(x => [x, x]), test: (a, v) => a.role === v }, { k: 'o', label: 'Outcome', options: [['Success', 'Success'], ['Rejected', 'Rejected'], ['Blocked', 'Blocked'], ['Ignored', 'Ignored']], test: (a, v) => a.outcome === v }]}
      sorts={[{ id: 'new', label: 'Newest', fn: (a, b) => b.at - a.at }]}
      cols={[{ k: 'at', label: 'Time', render: a => <span className="xs">{fmtDT(a.at)}</span> }, { k: 'ac', label: 'Actor', render: a => <span className="small">{a.actor}<span className="xs muted block">{a.role}</span></span> }, { k: 'a', label: 'Action', render: a => <b className="small">{a.action}</b> }, { k: 'o', label: 'Object', render: a => <code className="xs">{a.object}</code> }, { k: 'r', label: 'Reason', render: a => <span className="small">{a.reason}</span> }, { k: 'c', label: 'Change', render: a => <span className="xs">{a.before || a.after ? `${a.before || '—'} → ${a.after || '—'}` : ''}</span> }, { k: 's', label: 'Outcome', render: a => <Badge tone={a.outcome === 'Success' ? 'ok' : 'warn'}>{a.outcome}</Badge> }]} />
    {more.audit && <div className="row-gap center" style={{ padding: '12px 0' }}><Btn size="sm" onClick={() => loadMore('audit')}>Load older activity</Btn></div>}</>;
}
