import React from 'react';
import { Cpu, Database, HardDrive, Network, Clock, Activity } from 'lucide-react';
import { useT } from '../../i18n/useT';
import type { TKey } from '../../i18n/useT';
import { Card } from '../ui/Card';
import type { HassEntity } from '@hapulse/core';
import './SystemMonitorCard.css';

interface SystemMonitorCardProps {
  entities: HassEntity[];
}

type T = (key: TKey, vars?: Record<string, string | number>) => string;

type MetricGroup = {
  /** Stable identity — used as the React key, never displayed. */
  id: string;
  labelKey: TKey;
  icon: React.ReactNode;
  entities: HassEntity[];
};

function categorise(entities: HassEntity[]): MetricGroup[] {
  const processor: HassEntity[] = [];
  const memory:    HassEntity[] = [];
  const disk:      HassEntity[] = [];
  const network:   HassEntity[] = [];
  const system:    HassEntity[] = [];
  const other:     HassEntity[] = [];

  for (const e of entities) {
    const id = e.entity_id;
    if (/processor/.test(id)) processor.push(e);
    else if (/memory/.test(id)) memory.push(e);
    else if (/disk/.test(id)) disk.push(e);
    else if (/network|throughput_network/.test(id)) network.push(e);
    else if (/last_boot|uptime/.test(id)) system.push(e);
    else other.push(e);
  }

  const groups: MetricGroup[] = [
    { id: 'processor', labelKey: 'system.monitor.group.processor', icon: <Cpu size={14} strokeWidth={1.75} />, entities: processor },
    { id: 'memory',    labelKey: 'system.monitor.group.memory',    icon: <Database size={14} strokeWidth={1.75} />, entities: memory },
    { id: 'disk',      labelKey: 'system.monitor.group.disk',      icon: <HardDrive size={14} strokeWidth={1.75} />, entities: disk },
    { id: 'network',   labelKey: 'system.monitor.group.network',   icon: <Network size={14} strokeWidth={1.75} />, entities: network },
    { id: 'system',    labelKey: 'system.monitor.group.system',    icon: <Clock size={14} strokeWidth={1.75} />, entities: system },
    { id: 'other',     labelKey: 'system.monitor.group.misc',      icon: <Activity size={14} strokeWidth={1.75} />, entities: other },
  ];

  return groups.filter((g) => g.entities.length > 0);
}

function formatValue(entity: HassEntity, t: T): string {
  const unit = entity.attributes.unit_of_measurement as string | undefined;
  const val = entity.state;

  if (val === 'unavailable' || val === 'unknown') return '–';

  // Format timestamps (last_boot) as "X days ago" or similar
  if (entity.entity_id.includes('last_boot')) {
    try {
      const diff = Date.now() - new Date(val).getTime();
      const days  = Math.floor(diff / 86_400_000);
      const hours = Math.floor((diff % 86_400_000) / 3_600_000);
      if (days > 0) return t('system.monitor.uptimeDaysHours', { days, hours });
      return t('system.monitor.uptimeHoursAgo', { hours });
    } catch {
      return val;
    }
  }

  const num = parseFloat(val);
  if (!isNaN(num)) {
    const rounded = num < 10 ? num.toFixed(1) : Math.round(num).toString();
    return unit ? `${rounded} ${unit}` : rounded;
  }
  return unit ? `${val} ${unit}` : val;
}

function metricBarWidth(entity: HassEntity): number | null {
  const unit = entity.attributes.unit_of_measurement as string | undefined;
  if (unit !== '%') return null;
  const val = parseFloat(entity.state);
  return isNaN(val) ? null : Math.min(100, Math.max(0, val));
}

function barColorClass(val: number): string {
  if (val > 90) return 'sys-metric-bar__fill--critical';
  if (val > 75) return 'sys-metric-bar__fill--warn';
  return 'sys-metric-bar__fill--ok';
}

export function SystemMonitorCard({ entities }: SystemMonitorCardProps) {
  const t = useT();
  if (entities.length === 0) return null;

  const groups = categorise(entities);

  return (
    <Card className="sys-monitor-card">
      <div className="sys-monitor-card__header">
        <span className="sys-monitor-card__icon-chip" aria-hidden="true">
          <Cpu size={16} strokeWidth={1.75} />
        </span>
        <span className="sys-monitor-card__title">{t('system.monitor.title')}</span>
      </div>

      <div className="sys-monitor-card__groups card-scroll-body">
        {groups.map((group) => (
          <div key={group.id} className="sys-monitor-group">
            <div className="sys-monitor-group__label">
              <span aria-hidden="true">{group.icon}</span>
              {t(group.labelKey)}
            </div>
            <div className="sys-monitor-group__tiles">
              {group.entities.map((entity) => {
                const name = (
                  entity.attributes.friendly_name ?? entity.entity_id.split('.')[1]!
                ).replace(/_/g, ' ');
                const barPct = metricBarWidth(entity);
                const formatted = formatValue(entity, t);

                return (
                  <div key={entity.entity_id} className="sys-metric-tile">
                    <div className="sys-metric-tile__top">
                      <span className="sys-metric-tile__name" title={name}>{name}</span>
                      <span className="sys-metric-tile__value">{formatted}</span>
                    </div>
                    {barPct !== null && (
                      <div className="sys-metric-bar" aria-hidden="true">
                        <div
                          className={`sys-metric-bar__fill ${barColorClass(barPct)}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
