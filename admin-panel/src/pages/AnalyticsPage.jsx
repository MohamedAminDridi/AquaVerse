import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';

export default function AnalyticsPage() {
  const [farms, setFarms]     = useState([]);
  const [farmId, setFarmId]   = useState('');
  const [nodes, setNodes]     = useState([]);
  const [nodeId, setNodeId]   = useState('');
  const [history, setHistory] = useState([]);

  useEffect(() => { api.get('/farms').then(r => setFarms(r.data.data.farms)); }, []);

  // Farm picked → load its nodes and auto-select the first one.
  useEffect(() => {
    if (!farmId) { setNodes([]); setNodeId(''); return; }
    api.get(`/farms/${farmId}/nodes`).then((r) => {
      const list = r.data.data?.nodes || [];
      setNodes(list);
      setNodeId(list[0]?._id || '');
    }).catch(() => { setNodes([]); setNodeId(''); });
  }, [farmId]);

  // Node picked → load its 24h history buckets.
  useEffect(() => {
    if (!nodeId) { setHistory([]); return; }
    api.get(`/nodes/${nodeId}/history`).then(r => setHistory(r.data.data?.history || [])).catch(() => setHistory([]));
  }, [nodeId]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-gray-900 flex-1">Analytics</h1>
        <select value={farmId} onChange={e => setFarmId(e.target.value)}
          className="border border-gray-300 rounded-lg text-sm px-3 py-2">
          <option value="">Select farm</option>
          {farms.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
        </select>
        <select value={nodeId} onChange={e => setNodeId(e.target.value)} disabled={!nodes.length}
          className="border border-gray-300 rounded-lg text-sm px-3 py-2 disabled:opacity-50">
          <option value="">Select node</option>
          {nodes.map(n => <option key={n._id} value={n._id}>{n.name || n.device_id}</option>)}
        </select>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Soil moisture — 24h</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="avg_soil_moisture" stroke="#15803d" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {!history.length && <p className="text-xs text-gray-400 mt-2">Pick a farm and node to see its last 24 h.</p>}
      </div>
    </div>
  );
}
