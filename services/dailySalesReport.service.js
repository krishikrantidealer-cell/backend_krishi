const Order = require('../models/Order');
const User = require('../models/User');
const myoperatorService = require('./myoperator.service');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_AGENT_SLOTS = 15;

/**
 * Computes the UTC Date boundaries for the rolling 24-hour IST window
 * (yesterday 7:00 PM IST to today 7:00 PM IST) on a given YYYY-MM-DD (defaults to today in IST).
 */
function getIstWindow(dateStr = null) {
  let year, month, day;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [year, month, day] = dateStr.split('-').map(Number);
  } else {
    const nowIst = new Date(Date.now() + IST_OFFSET_MS);
    year = nowIst.getUTCFullYear();
    month = nowIst.getUTCMonth() + 1;
    day = nowIst.getUTCDate();
  }

  // Midnight UTC of that calendar date minus 5h30m = Midnight IST in UTC
  const istMidnightUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS;
  const startUtc = new Date(istMidnightUtcMs - 5 * 60 * 60 * 1000);      // Yesterday 19:00:00.000 IST (7:00 PM)
  const endUtc = new Date(istMidnightUtcMs + 19 * 60 * 60 * 1000 - 1);   // Today 18:59:59.999 IST (up to 7:00 PM)

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const displayDate = `${String(day).padStart(2, '0')} ${monthNames[month - 1]} ${year}`;
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { startUtc, endUtc, displayDate, isoDate };
}

function formatInr(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('en-IN');
}

function formatAgentLine(name, revenue) {
  const cleanName = String(name || 'Sales Agent').replace(/[\r\n\t]+/g, ' ').trim();
  return `${cleanName} — ₹${formatInr(revenue)}`;
}

/**
 * Aggregates rolling 24-hour IST sales (yesterday 7:00 PM - today 7:00 PM IST) across all active sales agents.
 */
async function buildDailySalesReport(dateStr = null) {
  const { startUtc, endUtc, displayDate, isoDate } = getIstWindow(dateStr);

const EXCLUDED_AGENT_EMAILS = new Set(['essentialbiosciences@gmail.com']);
const EXCLUDED_AGENT_NAMES = new Set(['ram shukla']);

  const [salesAgents, orders] = await Promise.all([
    User.find({
      role: 'sales',
      isDeleted: { $ne: true },
      isBlocked: { $ne: true }
    })
      .select('firstName lastName email')
      .lean(),
    Order.find({
      placedAt: { $gte: startUtc, $lte: endUtc },
      orderStatus: { $ne: 'Cancelled' }
    })
      .select('user totalAmount placedAt orderStatus')
      .populate('user', 'assignedAgent')
      .lean()
  ]);

  const agentStatsMap = new Map();
  for (const agent of salesAgents) {
    const id = String(agent._id);
    const email = String(agent.email || '').trim().toLowerCase();
    const fullName = `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || 'Sales Agent';
    if (EXCLUDED_AGENT_EMAILS.has(email) || EXCLUDED_AGENT_NAMES.has(fullName.toLowerCase())) {
      continue;
    }
    agentStatsMap.set(id, { id, name: fullName, revenue: 0, orders: 0 });
  }

  let totalRevenue = 0;
  let totalOrders = 0;
  let unassignedRevenue = 0;
  let unassignedOrders = 0;

  for (const order of orders) {
    const amount = Number(order.totalAmount) || 0;
    totalRevenue += amount;
    totalOrders += 1;

    const assignedId = order.user?.assignedAgent ? String(order.user.assignedAgent) : null;
    if (assignedId && agentStatsMap.has(assignedId)) {
      const entry = agentStatsMap.get(assignedId);
      entry.revenue += amount;
      entry.orders += 1;
    } else {
      unassignedRevenue += amount;
      unassignedOrders += 1;
    }
  }

const PREFERRED_AGENT_ORDER = [
  'ritik',
  'jaspal',
  'anshika',
  'runa',
  'ajay',
  'yogesh',
  'dhiraj',
  'govind',
  'keluth',
  'eram'
];

function getAgentSequenceIndex(name) {
  const normalized = String(name || '').trim().toLowerCase();
  const idx = PREFERRED_AGENT_ORDER.findIndex(prefix => normalized.startsWith(prefix));
  return idx === -1 ? PREFERRED_AGENT_ORDER.length : idx;
}

  const sortedAgents = Array.from(agentStatsMap.values()).sort((a, b) => {
    const idxA = getAgentSequenceIndex(a.name);
    const idxB = getAgentSequenceIndex(b.name);
    if (idxA !== idxB) return idxA - idxB;
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return a.name.localeCompare(b.name);
  });

  // Fill up to 15 template lines ({{4}} .. {{18}})
  const agentLines = [];
  if (sortedAgents.length <= MAX_AGENT_SLOTS) {
    for (const a of sortedAgents) {
      agentLines.push(formatAgentLine(a.name, a.revenue, a.orders));
    }
    if (unassignedOrders > 0 && agentLines.length < MAX_AGENT_SLOTS) {
      agentLines.push(formatAgentLine('Direct / Unassigned', unassignedRevenue, unassignedOrders));
    }
    while (agentLines.length < MAX_AGENT_SLOTS) {
      agentLines.push('—');
    }
  } else {
    for (let i = 0; i < MAX_AGENT_SLOTS - 1; i++) {
      const a = sortedAgents[i];
      agentLines.push(formatAgentLine(a.name, a.revenue, a.orders));
    }
    const remaining = sortedAgents.slice(MAX_AGENT_SLOTS - 1);
    const otherRev = remaining.reduce((s, a) => s + a.revenue, 0) + unassignedRevenue;
    const otherOrd = remaining.reduce((s, a) => s + a.orders, 0) + unassignedOrders;
    agentLines.push(formatAgentLine(`Others (${remaining.length})`, otherRev, otherOrd));
  }

  const bodyValues = [
    displayDate,
    formatInr(totalRevenue),
    ...agentLines
  ];

  return {
    isoDate,
    displayDate,
    windowStartUtc: startUtc.toISOString(),
    windowEndUtc: endUtc.toISOString(),
    totalRevenue,
    totalOrders,
    unassignedRevenue,
    unassignedOrders,
    agents: sortedAgents,
    bodyValues
  };
}

/**
 * Generates and dispatches the daily WhatsApp sales report via MyOperator Template.
 */
async function sendDailySalesReport({
  dateStr = null,
  recipients = null,
  templateName = null,
  dryRun = false
} = {}) {
  const report = await buildDailySalesReport(dateStr);

  const rawRecipients =
    recipients ||
    process.env.DAILY_SALES_REPORT_PHONES ||
    '9098544263,9399022066,9201896608';
  const phoneList = Array.from(
    new Set(
      String(rawRecipients)
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
    )
  );

  const resolvedTemplate =
    templateName ||
    process.env.DAILY_SALES_REPORT_TEMPLATE ||
    'daily_sales_report_v3';

  if (dryRun) {
    return {
      dryRun: true,
      templateName: resolvedTemplate,
      recipients: phoneList,
      report
    };
  }

  const results = [];
  for (const phone of phoneList) {
    try {
      const resp = await myoperatorService.sendMessage({
        phone,
        countryCode: '91',
        type: 'Template',
        templateName: resolvedTemplate,
        languageCode: 'en',
        bodyValues: report.bodyValues
      });
      results.push({ phone, success: true, response: resp });
    } catch (err) {
      console.error(`[DailySalesReport] Failed to send to ${phone}:`, err.message);
      results.push({ phone, success: false, error: err.message });
    }
  }

  return {
    dryRun: false,
    templateName: resolvedTemplate,
    recipients: phoneList,
    results,
    report
  };
}

module.exports = {
  getIstWindow,
  buildDailySalesReport,
  sendDailySalesReport
};
