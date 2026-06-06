// Topic convention MUST match what the gateway publishes/subscribes and what
// the backend MQTT client subscribes to in mqttClient.js:
//   farms/{farmId}/nodes/{nodeId}/{telemetry|status|command|ota|alerts}
//   farms/{farmId}/gateways/{gwId}/heartbeat
// (Previously these used a stale `farm/{farmId}/{nodeId}/…` form, so published
//  commands/OTA never reached the gateway → node never received them.)
module.exports = {
  telemetry: (farmId, nodeId) => `farms/${farmId}/nodes/${nodeId}/telemetry`,
  command:   (farmId, nodeId) => `farms/${farmId}/nodes/${nodeId}/command`,
  status:    (farmId, nodeId) => `farms/${farmId}/nodes/${nodeId}/status`,
  heartbeat: (farmId, gwId)  => `farms/${farmId}/gateways/${gwId}/heartbeat`,
  ota:       (farmId, nodeId) => `farms/${farmId}/nodes/${nodeId}/ota`,
  alert:     (farmId, nodeId) => `farms/${farmId}/nodes/${nodeId}/alerts`,
  allFarm:   (farmId)        => `farms/${farmId}/#`,
};
