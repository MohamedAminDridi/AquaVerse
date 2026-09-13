const mongoose = require('mongoose');
const Farm    = require('../models/Farm.model');
const Node    = require('../models/Node.model');
const Gateway = require('../models/Gateway.model');
const Alert   = require('../models/Alert.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');
const { farmIdsFor, accessMapFor } = require('../utils/scope');

// ─────────────────────────────────────────────────────────────────────────────
// Everything the mobile app needs to draw its first screen, in ONE request.
//
// It used to make ten: /farms, then /alerts/summary, then a /nodes and a
// /gateways per farm — and those ran in three sequential waves, so the round
// trips added up rather than overlapping. On a phone over Wi-Fi that was several
// seconds of blank screen after every login.
//
// Here the queries run in parallel inside the API, next to the database, and the
// client waits for one response.
// ─────────────────────────────────────────────────────────────────────────────
exports.overview = asyncHandler(async (req, res) => {
  // Scoped: a client must never receive farms it has no part in. Before this
  // line filtered, every authenticated account got the whole fleet.
  const scoped = await farmIdsFor(req.user);
  // Le niveau d'accès accompagne les données : l'interface masque les
  // commandes plutôt que de les proposer pour ensuite essuyer un refus.
  const access = await accessMapFor(req.user);
  const farms = await Farm.find({ _id: { $in: scoped } })
    .select('name crop_type size_ha location isActive').lean();
  const farmIds = farms.map((f) => f._id);

  // `lean()` and an explicit field list: this is a summary, and shipping whole
  // documents (heartbeat_log alone can hold 100 entries) is what makes a payload
  // slow to serialise, send and parse.
  const [nodes, gateways, summaryRows, openAlerts] = await Promise.all([
    Node.find({ farm: { $in: farmIds } })
      // La fiche mobile affiche tout l'etat d'un noeud : tension, courant,
      // veille et version de firmware en font partie. Ces champs sont scalaires
      // (sleep tient en six cles) — le poids ajoute reste negligeable devant le
      // heartbeat_log qu'on continue d'exclure.
      .select('name device_id status farm gateway last_seen battery_pct battery_charging '
            + 'battery_v battery_ma battery_time_min firmware_version sleep report_interval_sec zone '
            + 'soil_moisture_pct temperature humidity valve_state valve_pct pump_state')
      .lean(),

    Gateway.find({ farm: { $in: farmIds } })
      .select('name device_id status farm last_heartbeat ip rssi uptime_s tls_enabled')
      .lean(),

    // Sans ce $match, les décomptes portaient sur TOUTES les exploitations de la
    // plateforme : un client voyait le nombre d'alertes des autres.
    Alert.aggregate([
      { $match: { farm: { $in: farmIds } } },
      { $group: {
        _id:            '$farm',
        total:          { $sum: 1 },
        unacknowledged: { $sum: { $cond: [{ $eq: ['$acknowledged', false] }, 1, 0] } },
        critical:       { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'critical'] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        warning:        { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'warning'] },  { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        gatewayOpen:    { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$gateway', null] }, null] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        nodeOpen:       { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$node', null] }, null] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        latest:         { $max: '$createdAt' },
      } },
    ]),

    // Idem, en pire : cette liste est affichée telle quelle sur l'écran d'accueil,
    // avec le nom de l'exploitation, du nœud et de la passerelle concernés.
    Alert.find({ acknowledged: false, farm: { $in: farmIds } })
      .populate('node', 'name device_id')
      .populate('gateway', 'name device_id')
      .populate('farm', 'name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const byFarm = {};
  for (const r of summaryRows) {
    if (!r._id) continue;
    const { _id, ...counts } = r;
    byFarm[String(_id)] = counts;
  }

  success(res, { farms, nodes, gateways, byFarm, openAlerts, access });
});
