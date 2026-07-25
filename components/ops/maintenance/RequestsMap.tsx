'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { MaintenanceJob } from './MaintenanceJobDrawer';
import { SUBURB_COORDS, SERVICE_AREA_CENTER } from '@/modules/bin-maintenance/suburbCoordinates';

function isOverdue(job: MaintenanceJob) {
  if (!job.scheduled_date) return false;
  if (['COMPLETED', 'CLOSED'].includes(job.status)) return false;
  return new Date(job.scheduled_date) < new Date();
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

export default function RequestsMap({ jobs, onSuburbClick }: {
  jobs: MaintenanceJob[];
  onSuburbClick?: (suburb: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<LeafletMap | null>(null);
  const layerRef       = useRef<LayerGroup | null>(null);
  const leafletRef     = useRef<typeof import('leaflet') | null>(null);
  const jobsRef        = useRef(jobs);
  const onClickRef     = useRef(onSuburbClick);
  jobsRef.current    = jobs;
  onClickRef.current = onSuburbClick;

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = mod.default;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(SERVICE_AREA_CENTER, 11);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      renderMarkers();
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderMarkers() {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();

    const counts: Record<string, { label: string; count: number; critical: boolean; overdue: boolean }> = {};
    for (const j of jobsRef.current) {
      if (['COMPLETED', 'CLOSED'].includes(j.status)) continue;
      const key = j.suburb.toUpperCase();
      if (!counts[key]) counts[key] = { label: titleCase(key), count: 0, critical: false, overdue: false };
      counts[key].count++;
      if (j.severity === 'CRITICAL') counts[key].critical = true;
      if (isOverdue(j)) counts[key].overdue = true;
    }

    for (const [suburb, data] of Object.entries(counts)) {
      const coords = SUBURB_COORDS[suburb];
      if (!coords) continue;
      const color  = data.critical ? '#EF4444' : data.overdue ? '#F97316' : '#F59E0B';
      const radius = Math.min(6 + data.count * 0.9, 26);
      const marker = L.circleMarker(coords, {
        radius, color, weight: 1.2, fillColor: color, fillOpacity: 0.32,
      }).addTo(layer);
      marker.bindTooltip(
        `<b>${data.label}</b><br/>${data.count} active${data.critical ? ' · critical' : ''}${data.overdue ? ' · overdue' : ''}`,
        { direction: 'top', className: 'bm-map-tip', offset: [0, -radius] },
      );
      marker.on('click', () => onClickRef.current?.(data.label));
    }
  }

  useEffect(() => {
    renderMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#0a0d12' }} />;
}
