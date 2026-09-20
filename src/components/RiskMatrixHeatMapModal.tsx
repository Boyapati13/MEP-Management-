import React, { useEffect, useState } from 'react';
import {
  X, AlertTriangle, ShieldAlert, ShieldCheck, CheckCircle2,
  TrendingUp, ArrowUpRight, Flame, Target, User
} from 'lucide-react';
import { risksApi } from '../api';

interface RiskMatrixHeatMapModalProps {
  open?: boolean;
  projectId: string;
  onClose: () => void;
}

export const RiskMatrixHeatMapModal: React.FC<RiskMatrixHeatMapModalProps> = ({ open = true, projectId, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{ prob: number; imp: number } | null>(null);

  useEffect(() => {
    if (open) {
      loadMatrix();
    }
  }, [projectId, open]);

  if (!open) return null;

  const loadMatrix = async () => {
    try {
      setLoading(true);
      const res = await risksApi.matrix(projectId);
      setData(res);
    } catch (err) {
      console.error('Failed to load risk matrix:', err);
    } finally {
      setLoading(false);
    }
  };

  const getCellColor = (prob: number, imp: number) => {
    const score = prob * imp;
    if (score >= 15) return 'bg-rose-500 text-white hover:bg-rose-600';
    if (score >= 10) return 'bg-amber-500 text-white hover:bg-amber-600';
    if (score >= 5) return 'bg-yellow-400 text-slate-900 hover:bg-yellow-500';
    return 'bg-emerald-500 text-white hover:bg-emerald-600';
  };

  const getCellBorder = (prob: number, imp: number) => {
    const isSelected = selectedCell?.prob === prob && selectedCell?.imp === imp;
    return isSelected ? 'ring-4 ring-indigo-500 ring-offset-2 z-10' : '';
  };

  const activeRisksInSelectedCell = selectedCell && data?.matrix_grid
    ? data.matrix_grid[`${selectedCell.prob}_${selectedCell.imp}`] || []
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full my-8 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">5x5 Advanced Risk Heat Map</h2>
              <p className="text-xs text-slate-400">Probability vs. Impact severity matrix with real-time risk scores</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {loading ? (
            <div className="text-center py-16 text-slate-400">Loading risk heat map...</div>
          ) : !data ? (
            <div className="text-center py-16 text-slate-500">Failed to load risk heat map</div>
          ) : (
            <>
              {/* Severity Counts */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-700 uppercase">Critical Risks</span>
                    <Flame className="w-4 h-4 text-rose-600" />
                  </div>
                  <div className="text-2xl font-bold text-rose-900 mt-1">{data.summary.critical}</div>
                  <span className="text-[11px] text-rose-600">Score 15 - 25</span>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-700 uppercase">High Risks</span>
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-2xl font-bold text-amber-900 mt-1">{data.summary.high}</div>
                  <span className="text-[11px] text-amber-600">Score 10 - 14</span>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-yellow-700 uppercase">Medium Risks</span>
                    <TrendingUp className="w-4 h-4 text-yellow-600" />
                  </div>
                  <div className="text-2xl font-bold text-yellow-900 mt-1">{data.summary.medium}</div>
                  <span className="text-[11px] text-yellow-600">Score 5 - 9</span>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-700 uppercase">Low Risks</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-bold text-emerald-900 mt-1">{data.summary.low}</div>
                  <span className="text-[11px] text-emerald-600">Score 1 - 4</span>
                </div>
              </div>

              {/* 5x5 Heat Map Grid */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center justify-between">
                  <span>Probability vs. Impact Grid</span>
                  <span className="text-xs font-normal text-slate-500">Click any cell to inspect situated risks</span>
                </h3>

                <div className="flex">
                  {/* Y-Axis Label (Probability) */}
                  <div className="flex flex-col items-center justify-center pr-3">
                    <span className="-rotate-90 text-xs font-bold text-slate-500 uppercase tracking-wider select-none whitespace-nowrap">
                      Probability &rarr;
                    </span>
                  </div>

                  {/* Matrix */}
                  <div className="flex-1">
                    <div className="grid grid-rows-5 gap-2">
                      {[5, 4, 3, 2, 1].map(prob => (
                        <div key={prob} className="grid grid-cols-5 gap-2">
                          {[1, 2, 3, 4, 5].map(imp => {
                            const count = data.matrix_grid?.[`${prob}_${imp}`]?.length || 0;
                            return (
                              <button
                                key={`${prob}_${imp}`}
                                onClick={() => setSelectedCell({ prob, imp })}
                                className={`h-14 rounded-xl flex flex-col items-center justify-center font-bold text-sm transition-all shadow-xs cursor-pointer ${getCellColor(
                                  prob,
                                  imp
                                )} ${getCellBorder(prob, imp)}`}
                              >
                                <span className="text-xs opacity-80">P{prob} &bull; I{imp}</span>
                                <span className="text-base font-extrabold">{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* X-Axis Label (Impact) */}
                    <div className="grid grid-cols-5 gap-2 mt-2 text-center text-xs font-bold text-slate-500">
                      <span>1: Negligible</span>
                      <span>2: Minor</span>
                      <span>3: Moderate</span>
                      <span>4: Major</span>
                      <span>5: Catastrophic</span>
                    </div>
                    <div className="text-center mt-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Impact &rarr;
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected Cell Drill Down */}
              {selectedCell && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Risks in Cell (Probability: {selectedCell.prob}, Impact: {selectedCell.imp}) — Score: {selectedCell.prob * selectedCell.imp}
                    </h4>
                    <button
                      onClick={() => setSelectedCell(null)}
                      className="text-xs text-slate-400 hover:text-slate-600 underline"
                    >
                      Clear Selection
                    </button>
                  </div>

                  {activeRisksInSelectedCell.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No project risks currently situated in this cell.</p>
                  ) : (
                    <div className="space-y-2">
                      {activeRisksInSelectedCell.map((r: any) => (
                        <div key={r.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">{r.title}</span>
                            <span className="text-[11px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                              {r.category || 'General'}
                            </span>
                          </div>
                          {r.mitigation && (
                            <p className="text-xs text-slate-600"><span className="font-semibold">Mitigation:</span> {r.mitigation}</p>
                          )}
                          <div className="text-[11px] text-slate-400 flex items-center space-x-3">
                            {r.owner && <span>Owner: {r.owner}</span>}
                            {r.target_date && <span>Target: {r.target_date}</span>}
                            {r.linked_task_title && <span>Linked Task: {r.linked_task_title}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Top Risks Register */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Top Priority Risks & Mitigation Actions</h3>
                <div className="divide-y divide-slate-100">
                  {data.top_risks && data.top_risks.length > 0 ? (
                    data.top_risks.map((r: any) => (
                      <div key={r.id} className="py-3 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                              r.calculated_level === 'Critical' ? 'bg-rose-100 text-rose-800' :
                              r.calculated_level === 'High' ? 'bg-amber-100 text-amber-800' :
                              r.calculated_level === 'Medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              Score {r.calculated_score} &bull; {r.calculated_level}
                            </span>
                            <span className="text-xs text-slate-500 font-mono">{r.category}</span>
                          </div>
                          <h4 className="font-bold text-sm text-slate-900">{r.title}</h4>
                          {r.mitigation && (
                            <p className="text-xs text-slate-600"><span className="font-semibold">Strategy:</span> {r.mitigation}</p>
                          )}
                        </div>
                        <div className="text-right text-xs text-slate-500 space-y-0.5">
                          <div>Owner: <span className="font-medium text-slate-700">{r.owner || 'PM Team'}</span></div>
                          <div>Target: <span className="font-medium text-slate-700">{r.target_date || 'Ongoing'}</span></div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 py-3 italic">No risks recorded for this project.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm rounded-xl"
          >
            Close Matrix
          </button>
        </div>
      </div>
    </div>
  );
};
