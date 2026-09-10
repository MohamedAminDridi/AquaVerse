const Farm          = require('../models/Farm.model');
const Gateway       = require('../models/Gateway.model');
const Node          = require('../models/Node.model');
const Alert         = require('../models/Alert.model');
const AlertRule     = require('../models/AlertRule.model');
const Schedule      = require('../models/Schedule.model');
const Command       = require('../models/Command.model');
const Decision      = require('../models/Decision.model');
const SensorReading = require('../models/SensorReading.model');
const logger        = require('../utils/logger');

/**
 * Deleting equipment, and everything that hangs off it.
 *
 * The previous handlers were one line — `findByIdAndDelete` — which removed the
 * row and left every reference to it behind. A deleted farm kept its gateways,
 * nodes, alerts and readings in the database, reachable by nobody and counted by
 * every aggregate; a deleted gateway left its nodes pointing at an id that no
 * longer resolved, which is what the "nodes without a gateway" section in the
 * client application was quietly reporting.
 *
 * Two functions per kind. `*Impact` counts what a deletion would take with it,
 * so the interface can say it out loud before anyone commits; `delete*` performs
 * it. Nothing here asks who is calling — that is the caller's job, and keeping
 * the two apart is what makes this safe to reuse from a script.
 */

/* ── farms ────────────────────────────────────────────────────────────────── */

async function farmImpact(farmId) {
  const [gateways, nodes, alerts, schedules, rules, commands, decisions] = await Promise.all([
    Gateway.countDocuments({ farm: farmId }),
    Node.countDocuments({ farm: farmId }),
    Alert.countDocuments({ farm: farmId }),
    Schedule.countDocuments({ farm: farmId }),
    AlertRule.countDocuments({ farm: farmId }),
    Command.countDocuments({ farm: farmId }),
    Decision.countDocuments({ farm: farmId }),
  ]);
  // Readings are the volume item and live in a time-series collection, where a
  // count over a large range is itself expensive. Estimate from the node count
  // rather than blocking the dialog on it.
  const readings = await SensorReading.countDocuments({ 'meta.farmId': farmId }).catch(() => null);
  return { gateways, nodes, alerts, schedules, rules, commands, decisions, readings };
}

async function deleteFarm(farmId) {
  const impact = await farmImpact(farmId);
  // Order matters only for readability of the log; nothing here is referential.
  await Promise.all([
    SensorReading.deleteMany({ 'meta.farmId': farmId }).catch((e) => {
      logger.warn(`Readings not removed for farm ${farmId}: ${e.message}`);
    }),
    Command.deleteMany({ farm: farmId }),
    Decision.deleteMany({ farm: farmId }),
    Alert.deleteMany({ farm: farmId }),
    AlertRule.deleteMany({ farm: farmId }),
    Schedule.deleteMany({ farm: farmId }),
    Node.deleteMany({ farm: farmId }),
    Gateway.deleteMany({ farm: farmId }),
  ]);
  await Farm.findByIdAndDelete(farmId);
  logger.info(`Farm ${farmId} deleted with ${impact.nodes} node(s), ${impact.gateways} gateway(s)`);
  return impact;
}

/* ── gateways ─────────────────────────────────────────────────────────────── */

async function gatewayImpact(gwId) {
  const [nodes, alerts] = await Promise.all([
    Node.countDocuments({ gateway: gwId }),
    Alert.countDocuments({ gateway: gwId }),
  ]);
  const nodeNames = await Node.find({ gateway: gwId }).select('name device_id').limit(20).lean();
  return { nodes, alerts, nodeNames };
}

/**
 * Removing a gateway leaves its nodes without a relay. Two honest outcomes:
 * hand them to another gateway, or delete them too. Silently detaching them —
 * the old behaviour — produces equipment that exists, reports nothing, and
 * appears in no list.
 */
async function deleteGateway(gwId, { mode = 'detach', reassignTo = null } = {}) {
  const impact = await gatewayImpact(gwId);

  if (mode === 'cascade') {
    const ids = await Node.find({ gateway: gwId }).distinct('_id');
    for (const id of ids) await deleteNode(id);
  } else if (mode === 'reassign' && reassignTo) {
    await Node.updateMany({ gateway: gwId }, { gateway: reassignTo });
  } else {
    // detach: the node survives but is explicitly unattached rather than
    // pointing at a deleted document.
    await Node.updateMany({ gateway: gwId }, { $set: { gateway: null } });
  }

  await Alert.deleteMany({ gateway: gwId });
  await Gateway.findByIdAndDelete(gwId);
  logger.info(`Gateway ${gwId} deleted (${mode}, ${impact.nodes} node(s) affected)`);
  return impact;
}

/* ── nodes ────────────────────────────────────────────────────────────────── */

async function nodeImpact(nodeId) {
  const [alerts, commands, schedules, rules] = await Promise.all([
    Alert.countDocuments({ node: nodeId }),
    Command.countDocuments({ node: nodeId }),
    Schedule.countDocuments({ node: nodeId }),
    AlertRule.countDocuments({ node: nodeId }),
  ]);
  const readings = await SensorReading.countDocuments({ 'meta.nodeId': nodeId }).catch(() => null);
  return { alerts, commands, schedules, rules, readings };
}

async function deleteNode(nodeId) {
  const impact = await nodeImpact(nodeId);
  await Promise.all([
    SensorReading.deleteMany({ 'meta.nodeId': nodeId }).catch((e) => {
      logger.warn(`Readings not removed for node ${nodeId}: ${e.message}`);
    }),
    Command.deleteMany({ node: nodeId }),
    Alert.deleteMany({ node: nodeId }),
    // A schedule that targeted only this node has lost its subject; one that
    // targeted the whole farm is left alone.
    Schedule.deleteMany({ node: nodeId }),
    AlertRule.deleteMany({ node: nodeId }),
  ]);
  await Node.findByIdAndDelete(nodeId);
  logger.info(`Node ${nodeId} deleted with ${impact.readings ?? '?'} reading(s)`);
  return impact;
}

module.exports = {
  farmImpact, deleteFarm,
  gatewayImpact, deleteGateway,
  nodeImpact, deleteNode,
};
