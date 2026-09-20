/**
 * MEP Management Platform — V1.4.1 Activity Timeline Drawer
 * Displays chronological audit events, state transitions, and revision logs.
 */
import React from 'react';
import {
  History,
  X,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  FileEdit,
  PlusCircle,
  Shield,
  ArrowRight
} from 'lucide-react';

export interface TimelineEntry {
  id: string;
  timestamp: string;
  user_name?: string;
  action_type: 'create' | 'update' | 'status_change' | 'approval' | 'rejection' | 'revision' | string;
  summary: string;
  reference_no?: string;
  details?: Record<string, any>;
}

interface ActivityTimelineProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  entries: TimelineEntry[];
  loading?: boolean;
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  open,
  onClose,
  title,
  subtitle,
  entries,
  loading
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <History size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
              {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Body: Timeline */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs font-medium">Loading history log...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Clock size={36} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-gray-600 text-sm">No recorded activity</p>
              <p className="text-xs text-gray-400 mt-1">Changes and events will appear here chronologically</p>
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
              {entries.map((entry) => {
                const date = new Date(entry.timestamp);
                const formattedDate = !isNaN(date.getTime())
                  ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : entry.timestamp;

                return (
                  <div key={entry.id} className="relative group">
                    {/* Timeline Node Bullet */}
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-600 group-hover:scale-125 transition-transform" />

                    <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span className="font-medium text-gray-700">{entry.user_name || 'System'}</span>
                        <span className="text-[11px] text-gray-400">{formattedDate}</span>
                      </div>

                      {entry.reference_no && (
                        <span className="inline-block px-1.5 py-0.5 mb-1.5 rounded font-mono font-bold text-[10px] bg-blue-100 text-blue-800">
                          {entry.reference_no}
                        </span>
                      )}

                      <p className="text-xs font-semibold text-gray-800">{entry.summary}</p>

                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <div className="mt-2 text-[11px] bg-white p-2 rounded-lg border border-gray-100 text-gray-600 font-mono">
                          {Object.entries(entry.details).map(([k, v]) => (
                            <div key={k} className="truncate">
                              <span className="text-gray-400">{k}:</span> {String(v)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
