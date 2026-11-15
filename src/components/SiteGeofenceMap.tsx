import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, MapPin, Search, Loader2 } from 'lucide-react';

export interface SiteGeofenceMapProps {
  latitude: number | null;
  longitude: number | null;
  geofenceRadius: number;
  warningRadius: number;
  workerLocation?: { lat: number; lng: number; accuracy?: number } | null;
  readOnly?: boolean;
  height?: string;
  onChange?: (lat: number, lng: number) => void;
  onRadiusChange?: (validRadius: number, warningRadius: number) => void;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEFAULT_CENTER: [number, number] = [25.2048, 55.2708];

const sitePinIcon = L.divIcon({
  className: 'mep-site-pin',
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#2563eb;border:3px solid #ffffff;transform:rotate(-45deg);box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:50%;background:#ffffff;transform:rotate(45deg);"></div></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const workerPinIcon = L.divIcon({
  className: 'mep-worker-pin',
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#10b981;border:3px solid #ffffff;box-shadow:0 0 0 3px rgba(16,185,129,0.35);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export function SiteGeofenceMap({
  latitude,
  longitude,
  geofenceRadius,
  warningRadius,
  workerLocation,
  readOnly = false,
  height = '280px',
  onChange,
  onRadiusChange,
}: SiteGeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const validCircleRef = useRef<L.Circle | null>(null);
  const warningCircleRef = useRef<L.Circle | null>(null);
  const workerMarkerRef = useRef<L.Marker | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [mapNotice, setMapNotice] = useState('');

  const hasCoords = latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude);
  const center: [number, number] = hasCoords ? [latitude!, longitude!] : DEFAULT_CENTER;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom: hasCoords ? 16 : 11,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    if (!readOnly) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        onChange?.(lat, lng);
      });
    }

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      validCircleRef.current = null;
      warningCircleRef.current = null;
      workerMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (hasCoords) {
      const pos: [number, number] = [latitude!, longitude!];

      if (!markerRef.current) {
        const marker = L.marker(pos, { icon: sitePinIcon, draggable: !readOnly }).addTo(map);
        if (!readOnly) {
          marker.on('dragend', () => {
            const p = marker.getLatLng();
            onChange?.(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
          });
        }
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng(pos);
      }

      const validR = Math.max(10, Number(geofenceRadius) || 100);
      const warnR = Math.max(validR, Number(warningRadius) || 150);

      if (!warningCircleRef.current) {
        warningCircleRef.current = L.circle(pos, {
          radius: warnR,
          color: '#f59e0b',
          weight: 1.5,
          dashArray: '5, 5',
          fillColor: '#f59e0b',
          fillOpacity: 0.08,
        }).addTo(map);
      } else {
        warningCircleRef.current.setLatLng(pos).setRadius(warnR);
      }

      if (!validCircleRef.current) {
        validCircleRef.current = L.circle(pos, {
          radius: validR,
          color: '#16a34a',
          weight: 2,
          fillColor: '#22c55e',
          fillOpacity: 0.16,
        }).addTo(map);
      } else {
        validCircleRef.current.setLatLng(pos).setRadius(validR);
      }

      map.setView(pos, Math.max(map.getZoom(), 15), { animate: true });
    }
  }, [latitude, longitude, geofenceRadius, warningRadius, hasCoords, readOnly]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (workerLocation && Number.isFinite(workerLocation.lat) && Number.isFinite(workerLocation.lng)) {
      const wPos: [number, number] = [workerLocation.lat, workerLocation.lng];
      if (!workerMarkerRef.current) {
        workerMarkerRef.current = L.marker(wPos, { icon: workerPinIcon }).addTo(map).bindTooltip('Your Current GPS');
      } else {
        workerMarkerRef.current.setLatLng(wPos);
      }
    } else if (workerMarkerRef.current) {
      workerMarkerRef.current.remove();
      workerMarkerRef.current = null;
    }
  }, [workerLocation]);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setMapNotice('');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery.trim())}`,
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = Number(parseFloat(data[0].lat).toFixed(6));
        const lng = Number(parseFloat(data[0].lon).toFixed(6));
        onChange?.(lat, lng);
        mapRef.current?.setView([lat, lng], 16);
      } else {
        setMapNotice('Location not found. Try a city or street name, or click directly on the map.');
      }
    } catch {
      setMapNotice('Map search unavailable offline. Click on the map or enter GPS coordinates.');
    } finally {
      setSearching(false);
    }
  }

  function handleUseMyGps() {
    if (!navigator.geolocation) {
      setMapNotice('Geolocation is not supported by this browser.');
      return;
    }
    setGpsBusy(true);
    setMapNotice('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        onChange?.(lat, lng);
        mapRef.current?.setView([lat, lng], 17);
        setGpsBusy(false);
      },
      (err) => {
        setMapNotice(err.message || 'Could not acquire GPS location.');
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const distanceMeters =
    hasCoords && workerLocation
      ? Math.round(haversineMeters(latitude!, longitude!, workerLocation.lat, workerLocation.lng))
      : null;

  const geofenceStatus =
    distanceMeters === null
      ? null
      : distanceMeters <= (geofenceRadius || 100)
        ? { label: `Inside Valid Zone (${distanceMeters}m from site)`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : distanceMeters <= (warningRadius || 150)
          ? { label: `Warning Zone (${distanceMeters}m from site)`, cls: 'bg-amber-50 text-amber-700 border-amber-200' }
          : { label: `Outside Site Boundary (${distanceMeters}m from site)`, cls: 'bg-red-50 text-red-700 border-red-200' };

  return (
    <div className="space-y-2.5">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="Search site address or city..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={searching}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1"
            >
              {searching ? <Loader2 size={12} className="animate-spin" /> : null}
              Find
            </button>
          </div>
          <button
            type="button"
            onClick={handleUseMyGps}
            disabled={gpsBusy}
            className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {gpsBusy ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />}
            Use My GPS
          </button>
        </div>
      )}

      <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-inner bg-slate-100" style={{ height }}>
        <div ref={containerRef} className="w-full h-full z-0" />
        {!readOnly && (
          <div className="absolute bottom-2 left-2 z-[400] bg-white/95 backdrop-blur px-2.5 py-1 rounded-md shadow text-[11px] font-medium text-slate-700 flex items-center gap-1.5 pointer-events-none">
            <MapPin size={12} className="text-blue-600" />
            Click map or drag blue pin to set site point
          </div>
        )}
      </div>

      {!readOnly && onRadiusChange && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Site Attendance Boundary (Green Circle)</span>
            <span className="font-mono text-emerald-700">{geofenceRadius}m radius</span>
          </div>
          <input
            type="range"
            min={30}
            max={1000}
            step={10}
            value={geofenceRadius}
            onChange={(e) => {
              const valid = Number(e.target.value);
              const warn = Math.max(valid + 50, warningRadius);
              onRadiusChange(valid, warn);
            }}
            className="w-full accent-emerald-600 cursor-pointer"
          />
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>30m (Tight site gate)</span>
            <span>Warning zone: {Math.max(geofenceRadius, warningRadius)}m (Amber)</span>
            <span>1000m (Large campus)</span>
          </div>
        </div>
      )}

      {geofenceStatus && (
        <div className={`px-3 py-2 rounded-lg border text-xs font-semibold ${geofenceStatus.cls}`}>
          {geofenceStatus.label}
        </div>
      )}

      {mapNotice && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{mapNotice}</p>}
    </div>
  );
}
