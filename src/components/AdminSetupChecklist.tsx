/**
 * MEP Management Platform — V1.4.1 Admin Project Setup & Onboarding Checklist
 * Provides clear readiness visibility for operational launch.
 */
import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  ShieldCheck,
  Building,
  Calendar,
  Users,
  MapPin,
  Layers,
  FileText,
  AlertCircle
} from 'lucide-react';
import { api } from '../api';

interface SetupItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  category: string;
  route: string;
}

interface AdminSetupChecklistProps {
  projectId: string;
  onNavigate: (route: string) => void;
}

export const AdminSetupChecklist: React.FC<AdminSetupChecklistProps> = ({
  projectId,
  onNavigate
}) => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SetupItem[]>([]);

  useEffect(() => {
    async function evaluateReadiness() {
      try {
        setLoading(true);
        // Fetch project counts
        const [wps, tasks, sites, workers, risks] = await Promise.all([
          api.get(`/api/work_packages?project_id=${projectId}`).catch(() => []),
          api.get(`/api/tasks?project_id=${projectId}`).catch(() => []),
          api.get(`/api/sites?project_id=${projectId}`).catch(() => []),
          api.get(`/api/workers?project_id=${projectId}`).catch(() => []),
          api.get(`/api/project_risks?project_id=${projectId}`).catch(() => [])
        ]);

        const evaluated: SetupItem[] = [
          {
            id: 'wp_setup',
            title: 'Define Work Packages',
            description: 'Decompose MEP scope into trade packages and assign subcontracting partners',
            completed: Array.isArray(wps) && wps.length > 0,
            category: 'Delivery',
            route: 'work-packages'
          },
          {
            id: 'schedule_setup',
            title: 'Populate Baseline Schedule',
            description: 'Import or create milestone tasks with start and end dates',
            completed: Array.isArray(tasks) && tasks.length > 0,
            category: 'Delivery',
            route: 'tasks'
          },
          {
            id: 'site_geofence',
            title: 'Configure Physical Site & Geofence',
            description: 'Set GPS coordinates and perimeter radius for mobile attendance verification',
            completed: Array.isArray(sites) && sites.length > 0,
            category: 'Site',
            route: 'sites'
          },
          {
            id: 'workforce_roster',
            title: 'Register Field Workforce',
            description: 'Onboard site engineers, supervisors, and trade specialists',
            completed: Array.isArray(workers) && workers.length > 0,
            category: 'Site',
            route: 'workers'
          },
          {
            id: 'risk_baseline',
            title: 'Baseline Risk Matrix',
            description: 'Identify technical, safety, and commercial hazards with 5x5 impact rating',
            completed: Array.isArray(risks) && risks.length > 0,
            category: 'Controls',
            route: 'risks'
          }
        ];

        setItems(evaluated);
      } finally {
        setLoading(false);
      }
    }

    if (projectId) {
      evaluateReadiness();
    }
  }, [projectId]);

  const completedCount = items.filter(i => i.completed).length;
  const progressPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-blue-600" size={22} />
            <h3 className="text-lg font-bold text-gray-900">Project Operational Setup Checklist</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Ensure essential project controls and workforce configurations are established prior to field mobilization
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-sm font-bold text-gray-900">{progressPercent}%</span>
            <span className="text-xs text-gray-400 block">{completedCount} of {items.length} Ready</span>
          </div>
          <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-gray-400">Evaluating configuration checklist...</div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => onNavigate(item.route)}
              className="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 cursor-pointer transition-all group"
            >
              <div className="flex items-start gap-3">
                {item.completed ? (
                  <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <Circle size={18} className="text-gray-300 flex-shrink-0 mt-0.5 group-hover:text-blue-400" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900">{item.title}</span>
                    <span className="text-[10px] px-2 py-0.2 rounded font-medium bg-gray-100 text-gray-600">
                      {item.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 group-hover:translate-x-0.5 transition-transform">
                <span>{item.completed ? 'Review' : 'Configure'}</span>
                <ArrowRight size={14} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
