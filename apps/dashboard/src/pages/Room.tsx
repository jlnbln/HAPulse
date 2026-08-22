import React, { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ChevronLeft, GripVertical, Scaling,
  Sparkles, Sun, Moon, Coffee, Tv, Music2, Sunset, PartyPopper, BookOpen,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SectionLabel } from '../components/ui/SectionLabel';
import { IconButton } from '../components/ui/IconButton';
import { EditToggle } from '../components/ui/EditToggle';
import { PageHeaderActions } from '../components/ui/PageHeaderActions';
import { EditBadge } from '../components/ui/EditBadge';
import { SortableGrid } from '../components/ui/SortableGrid';
import { SortableItem } from '../components/ui/SortableItem';
import { EntityCard } from '../components/cards/EntityCard';
import { LightCard } from '../components/cards/LightCard';
import { ClimateCard } from '../components/cards/ClimateCard';
import { MediaCard } from '../components/cards/MediaCard';
import { CoverCard } from '../components/cards/CoverCard';
import { ToggleCard } from '../components/cards/ToggleCard';
import { SensorTile } from '../components/cards/SensorTile';
import { ButtonCard } from '../components/cards/ButtonCard';
import { VacuumCard } from '../components/cards/VacuumCard';
import { HeroRoomCard } from '../components/home/HeroRoomCard';
import { callService } from '../ha/service';
import { useRoom, useEntityMap, useCustomization } from '../ha/hooks';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { applyStoredOrder } from '../lib/order';
import { useT, type TKey } from '../i18n/useT';
import './Page.css';
import './Room.css';

// ── Entity name helpers ───────────────────────────────────────────────────────

function stripRoomName(name: string, roomName: string): string {
  if (!roomName) return name;
  const escaped = roomName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = name
    .replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped : name;
}

// ── Scene helpers ─────────────────────────────────────────────────────────────

const SCENE_ICON_COLORS = [
  { bg: 'var(--accent-soft)', color: 'var(--accent)' },
  { bg: 'var(--info-soft)', color: 'var(--info)' },
  { bg: 'var(--positive-soft)', color: 'var(--positive)' },
  { bg: 'var(--warning-soft)', color: 'var(--warning)' },
] as const;

function sceneIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  if (n.includes('morning') || n.includes('sunrise') || n.includes('wake')) return <Sun size={16} strokeWidth={1.75} />;
  if (n.includes('night') || n.includes('sleep') || n.includes('bed')) return <Moon size={16} strokeWidth={1.75} />;
  if (n.includes('relax') || n.includes('chill') || n.includes('calm')) return <Sunset size={16} strokeWidth={1.75} />;
  if (n.includes('movie') || n.includes('cinema') || n.includes('tv')) return <Tv size={16} strokeWidth={1.75} />;
  if (n.includes('music') || n.includes('party')) return <PartyPopper size={16} strokeWidth={1.75} />;
  if (n.includes('read') || n.includes('study') || n.includes('focus')) return <BookOpen size={16} strokeWidth={1.75} />;
  if (n.includes('coffee') || n.includes('breakfast')) return <Coffee size={16} strokeWidth={1.75} />;
  if (n.includes('concert') || n.includes('audio') || n.includes('sound')) return <Music2 size={16} strokeWidth={1.75} />;
  return <Sparkles size={16} strokeWidth={1.75} />;
}

// ── Section width (2-column grid) ─────────────────────────────────────────────

const ROOM_MAX_COLS = 2;

/** Stored room-section spans are keyed `${areaId}:${sectionKey}`. Default 2 (full). */
function roomSpanKey(areaId: string, sectionKey: string): string {
  return `${areaId}:${sectionKey}`;
}

function getRoomSpan(areaId: string, sectionKey: string, stored: Record<string, number>): number {
  const v = stored[roomSpanKey(areaId, sectionKey)] ?? ROOM_MAX_COLS;
  return Math.max(1, Math.min(ROOM_MAX_COLS, v));
}

function roomSpanClass(span: number): string {
  return span >= ROOM_MAX_COLS ? 'room-page__section--span-2' : 'room-page__section--span-1';
}

/** Two-block indicator of the section's current width (edit mode). */
function RoomSpanDots({ span }: { span: number }) {
  return (
    <div className="room-section__span-dots" aria-hidden="true">
      {Array.from({ length: ROOM_MAX_COLS }, (_, i) => (
        <span
          key={i}
          className={`room-section__span-dot${i < span ? ' room-section__span-dot--filled' : ''}`}
        />
      ))}
    </div>
  );
}

/** Drag left/right to change a room section between half and full width. */
function RoomResizeHandle({
  span,
  onCommit,
}: {
  span: number;
  onCommit: (newSpan: number) => void;
}) {
  const t = useT();

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation(); // don't start a section drag

    const btn = e.currentTarget;
    btn.setPointerCapture(e.pointerId);

    const sectionEl = btn.closest('.room-page__section') as HTMLElement | null;
    const gridEl = btn.closest('.room-page__sections') as HTMLElement | null;
    if (!sectionEl || !gridEl) return;

    const colWidth = gridEl.getBoundingClientRect().width / ROOM_MAX_COLS;
    const startX = e.clientX;
    const startSpan = span;
    let previewSpan = startSpan;

    function onMove(me: PointerEvent) {
      const delta = Math.round((me.clientX - startX) / colWidth);
      const next = Math.max(1, Math.min(ROOM_MAX_COLS, startSpan + delta));
      if (next !== previewSpan) {
        previewSpan = next;
        sectionEl!.style.gridColumn = next >= ROOM_MAX_COLS ? '1 / -1' : 'span 1';
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      sectionEl!.style.gridColumn = ''; // class takes over after re-render
      onCommit(previewSpan);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  return (
    <button
      type="button"
      className="room-section__resize-handle"
      onPointerDown={handlePointerDown}
      aria-label={t('columnResize.ariaLabel', { span, max: ROOM_MAX_COLS })}
      title={t('columnResize.title', { span, max: ROOM_MAX_COLS })}
    >
      <Scaling size={12} strokeWidth={2.5} />
    </button>
  );
}

// ── Sortable section wrapper ──────────────────────────────────────────────────

const DRAG_REORDER_KEYS: Record<SectionKey, TKey> = {
  scene: 'room.section.dragReorder.scene',
  light: 'room.section.dragReorder.light',
  climate: 'room.section.dragReorder.climate',
  media_player: 'room.section.dragReorder.mediaPlayer',
  cover: 'room.section.dragReorder.cover',
  switches: 'room.section.dragReorder.switches',
  button: 'room.section.dragReorder.button',
  vacuum: 'room.section.dragReorder.vacuum',
  sensor: 'room.section.dragReorder.sensor',
  binary_sensor: 'room.section.dragReorder.sensor',
  other: 'room.section.dragReorder.misc',
};

function SortableSectionInner({
  id,
  label,
  span,
  onCommitSpan,
  children,
}: {
  id: SectionKey;
  label: string;
  span: number;
  onCommitSpan: (newSpan: number) => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <section
      ref={setNodeRef}
      className={[
        'room-page__section',
        roomSpanClass(span),
        isDragging ? 'room-page__section--dragging' : '',
      ].filter(Boolean).join(' ')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
      {...attributes}
    >
      <div className="room-section__label-row">
        <button
          ref={setActivatorNodeRef}
          className="room-section__grip"
          type="button"
          aria-label={t(DRAG_REORDER_KEYS[id])}
          {...listeners}
        >
          <GripVertical size={14} strokeWidth={1.75} />
        </button>
        <SectionLabel>{label}</SectionLabel>
      </div>
      {children}
      <RoomSpanDots span={span} />
      <RoomResizeHandle span={span} onCommit={onCommitSpan} />
    </section>
  );
}

// ── Section config ────────────────────────────────────────────────────────────

const SECTION_ORDER = [
  'scene',
  'light',
  'climate',
  'media_player',
  'cover',
  'switches',
  'button',
  'vacuum',
  'sensor',
  'binary_sensor',
  'other',
] as const;

type SectionKey = (typeof SECTION_ORDER)[number];

const SECTION_LABEL_KEYS: Record<string, TKey> = {
  scene:        'room.section.label.scene',
  light:        'room.section.label.light',
  climate:      'room.section.label.climate',
  media_player: 'room.section.label.mediaPlayer',
  cover:        'room.section.label.cover',
  switches:     'room.section.label.switches',
  button:       'room.section.label.button',
  vacuum:       'room.section.label.vacuum',
  sensor:       'room.section.label.sensor',
  binary_sensor:'room.section.label.sensor',
  other:        'room.section.label.misc',
};

const SWITCH_DOMAINS = new Set(['switch', 'fan', 'input_boolean']);
const CORE_DOMAINS = new Set([
  'scene', 'light', 'climate', 'media_player', 'cover',
  'switch', 'fan', 'input_boolean', 'button', 'vacuum',
  'sensor', 'binary_sensor',
]);


// ── Component ─────────────────────────────────────────────────────────────────

export function Room() {
  const t = useT();
  const { areaId } = useParams<{ areaId: string }>();
  const navigate = useNavigate();
  const room = useRoom(areaId ?? '');
  const entities = useEntityMap();
  const customization = useCustomization();
  const editMode = useUIStore((s) => s.editMode);
  const updateCustomization = useSettingsStore((s) => s.updateCustomization);
  const { hiddenEntities, entityOverrides, entityOrder, favorites, roomSectionOrder, roomSectionSpans } = customization;

  if (!areaId || !room) {
    return (
      <div className="page room-page stagger-rise">
        <div className="room-page__not-found">
          <div className="room-page__not-found-title">{t('room.notFound.title')}</div>
          <button
            type="button"
            className="room-page__not-found-link"
            onClick={() => void navigate('/')}
          >
            {t('room.backToHome')}
          </button>
        </div>
      </div>
    );
  }

  function handleToggleEntity(entityId: string) {
    const next = hiddenEntities.includes(entityId)
      ? hiddenEntities.filter((id) => id !== entityId)
      : [...hiddenEntities, entityId];
    updateCustomization({ hiddenEntities: next });
  }

  function handleToggleFavorite(entityId: string) {
    const next = favorites.includes(entityId)
      ? favorites.filter((id) => id !== entityId)
      : [...favorites, entityId];
    updateCustomization({ favorites: next });
  }

  function handleReorderSection(
    sectionKey: string,
    newSectionIds: string[],
    sectionsSnap: Record<string, string[]>
  ) {
    if (!areaId) return;
    const combined: string[] = [];
    for (const key of SECTION_ORDER) {
      if (key === sectionKey) {
        combined.push(...newSectionIds);
      } else if (sectionsSnap[key]) {
        combined.push(...sectionsSnap[key]!);
      }
    }
    updateCustomization({ entityOrder: { ...entityOrder, [areaId]: combined } });
  }

  const handleReorderSections = useCallback(
    (newKeys: string[]) => {
      if (!areaId) return;
      updateCustomization({
        roomSectionOrder: { ...roomSectionOrder, [areaId]: newKeys },
      });
    },
    [areaId, roomSectionOrder, updateCustomization]
  );

  const handleSectionSpanChange = useCallback(
    (sectionKey: string, newSpan: number) => {
      if (!areaId) return;
      updateCustomization({
        roomSectionSpans: { ...roomSectionSpans, [roomSpanKey(areaId, sectionKey)]: newSpan },
      });
    },
    [areaId, roomSectionSpans, updateCustomization]
  );

  // Gather domain → ids
  const domainMap: Record<string, string[]> = {};
  for (const [domain, ids] of Object.entries(room.domains)) {
    const filtered = editMode
      ? ids.filter((id) => id in entities)
      : ids.filter((id) => !hiddenEntities.includes(id) && id in entities);
    if (filtered.length > 0) {
      domainMap[domain] = filtered;
    }
  }

  // Group switch and other ids
  const switchIds: string[] = [];
  const otherIds: string[] = [];
  for (const domain of Object.keys(domainMap)) {
    if (SWITCH_DOMAINS.has(domain)) {
      switchIds.push(...(domainMap[domain] ?? []));
    } else if (!CORE_DOMAINS.has(domain)) {
      otherIds.push(...(domainMap[domain] ?? []));
    }
  }

  function getEntityName(entityId: string): string {
    const override = entityOverrides[entityId];
    if (override?.name) return override.name;
    const friendly = entities[entityId]?.attributes?.friendly_name as string | undefined;
    if (friendly) return stripRoomName(friendly, room?.name ?? '');
    return entityId;
  }

  const storedAreaOrder = entityOrder[areaId];
  function orderedIds(raw: string[]): string[] {
    return applyStoredOrder(raw, storedAreaOrder?.filter((id) => raw.includes(id)));
  }

  const sceneIds        = orderedIds(domainMap['scene']        ?? []);
  const lightIds        = orderedIds(domainMap['light']        ?? []);
  const climateIds      = orderedIds(domainMap['climate']      ?? []);
  const mediaIds        = orderedIds(domainMap['media_player'] ?? []);
  const coverIds        = orderedIds(domainMap['cover']        ?? []);
  const buttonIds       = orderedIds(domainMap['button']       ?? []);
  const vacuumIds       = orderedIds(domainMap['vacuum']       ?? []);
  const orderedSwitchIds = orderedIds(switchIds);
  const rawSensorIds = [...(domainMap['sensor'] ?? []), ...(domainMap['binary_sensor'] ?? [])];
  const sensorIds       = orderedIds(rawSensorIds);
  const orderedOtherIds = orderedIds(otherIds);

  const sectionsSnap: Record<string, string[]> = {
    scene:        sceneIds,
    light:        lightIds,
    climate:      climateIds,
    media_player: mediaIds,
    cover:        coverIds,
    switches:     orderedSwitchIds,
    button:       buttonIds,
    vacuum:       vacuumIds,
    sensor:       sensorIds,
    binary_sensor:[],
    other:        orderedOtherIds,
  };

  // ── Card renderer ───────────────────────────────────────────────────────────

  function renderCard(key: SectionKey, entityId: string, isSensor: boolean, idx: number) {
    const entity = entities[entityId];
    if (!entity) return null;
    const name = getEntityName(entityId);
    const isHidden = hiddenEntities.includes(entityId);

    const cardNode: React.ReactNode = (() => {
      if (isSensor) return <SensorTile key={entityId} entity={entity} name={name} />;
      if (key === 'scene') {
        const palette = SCENE_ICON_COLORS[idx % SCENE_ICON_COLORS.length]!;
        const displayName = name.replace(/_/g, ' ');
        return (
          <button
            key={entityId}
            className={['scene-tile', 'scene-tile--compact', isHidden && editMode ? 'scene-tile--hidden' : ''].filter(Boolean).join(' ')}
            onClick={() => void callService('scene', 'turn_on', {}, { entity_id: entityId })}
            aria-label={t('room.scene.activate', { name: displayName })}
            type="button"
          >
            <span className="scene-tile__icon" style={{ background: palette.bg, color: palette.color }} aria-hidden="true">
              {sceneIcon(displayName)}
            </span>
            <span className="scene-tile__name">{displayName}</span>
          </button>
        );
      }
      switch (key) {
        case 'light':        return <LightCard   key={entityId} entity={entity} name={name} />;
        case 'climate':      return <ClimateCard  key={entityId} entity={entity} name={name} />;
        case 'media_player': return <MediaCard    key={entityId} entity={entity} name={name} />;
        case 'cover':        return <CoverCard    key={entityId} entity={entity} name={name} />;
        case 'switches':     return <ToggleCard   key={entityId} entity={entity} name={name} />;
        case 'button':       return <ButtonCard   key={entityId} entity={entity} name={name} />;
        case 'vacuum':       return <VacuumCard   key={entityId} entity={entity} name={name} />;
        default:             return <EntityCard   key={entityId} entity={entity} name={name} />;
      }
    })();

    const isUnavailable = entity.state === 'unavailable';
    const finalNode = isUnavailable
      ? <div key={entityId} className="entity-unavailable">{cardNode}</div>
      : cardNode;

    if (!editMode) return finalNode;

    return (
      <SortableItem key={entityId} id={entityId} editMode={editMode}>
        <div
          className={[
            'edit-entity-wrap',
            'edit-entity-wrap--editing',
            isHidden ? 'edit-entity-wrap--hidden' : '',
            isUnavailable ? 'edit-entity-wrap--unavailable' : '',
          ].filter(Boolean).join(' ')}
        >
          <div className="edit-item-outline" style={{ borderRadius: 'var(--radius-card)' }}>
            {cardNode}
          </div>
          <EditBadge
            hidden={isHidden}
            toggleLabel={isHidden ? t('editBadge.show', { label: name }) : t('editBadge.hide', { label: name })}
            onToggleHidden={() => handleToggleEntity(entityId)}
            favorite={favorites.includes(entityId)}
            onToggleFavorite={() => handleToggleFavorite(entityId)}
            entityName={name}
          />
        </div>
      </SortableItem>
    );
  }

  // ── Section data ────────────────────────────────────────────────────────────

  type SectionDef = {
    key: SectionKey;
    label: string;
    ids: string[];
    isSensor?: boolean;
  };

  const allSectionDefs: SectionDef[] = [
    { key: 'scene',        label: t(SECTION_LABEL_KEYS['scene']!),        ids: sceneIds },
    { key: 'light',        label: t(SECTION_LABEL_KEYS['light']!),        ids: lightIds },
    { key: 'climate',      label: t(SECTION_LABEL_KEYS['climate']!),      ids: climateIds },
    { key: 'media_player', label: t(SECTION_LABEL_KEYS['media_player']!), ids: mediaIds },
    { key: 'cover',        label: t(SECTION_LABEL_KEYS['cover']!),        ids: coverIds },
    { key: 'switches',     label: t(SECTION_LABEL_KEYS['switches']!),     ids: orderedSwitchIds },
    { key: 'button',       label: t(SECTION_LABEL_KEYS['button']!),       ids: buttonIds },
    { key: 'vacuum',       label: t(SECTION_LABEL_KEYS['vacuum']!),       ids: vacuumIds },
    { key: 'sensor',       label: t(SECTION_LABEL_KEYS['sensor']!),       ids: sensorIds, isSensor: true },
    { key: 'other',        label: t(SECTION_LABEL_KEYS['other']!),        ids: orderedOtherIds },
  ];

  const activeSectionDefs = allSectionDefs.filter((s) => s.ids.length > 0);

  const storedRoomSectionOrder = roomSectionOrder[areaId];
  const orderedSectionDefs = applyStoredOrder(
    activeSectionDefs.map((s) => s.key),
    storedRoomSectionOrder
  )
    .map((key) => activeSectionDefs.find((s) => s.key === key))
    .filter((s): s is SectionDef => s != null);

  // ── Section content renderer ────────────────────────────────────────────────

  function renderSectionContent(s: SectionDef): React.ReactNode {
    const { key, ids, isSensor } = s;
    const gridClass = isSensor
      ? 'room-page__sensor-grid'
      : key === 'scene'
      ? 'room-page__scene-grid'
      : key === 'climate' || key === 'vacuum'
      ? 'room-page__wide-card-grid'
      : 'room-page__card-grid';

    return (
      <SortableGrid
        items={ids}
        onReorder={(newIds) => handleReorderSection(key, newIds, sectionsSnap)}
        editMode={editMode}
        className={gridClass}
      >
        {ids.map((entityId, idx) => renderCard(key, entityId, isSensor ?? false, idx))}
      </SortableGrid>
    );
  }

  const isEmpty = orderedSectionDefs.length === 0;

  return (
    <div className="page room-page stagger-rise">
      {/* Mobile-only top bar: back + edit toggle (desktop uses AppLayout header) */}
      <div className="room-page__header">
        <IconButton
          label={t('common.back')}
          size={40}
          variant="ghost"
          onClick={() => void navigate(-1)}
        >
          <ChevronLeft size={20} strokeWidth={1.75} />
        </IconButton>
        <PageHeaderActions>
          <EditToggle className="room-page__edit-toggle" />
        </PageHeaderActions>
      </div>

      {/* Hero room card */}
      <HeroRoomCard rooms={[room]} entities={entities} />

      {/* Sections */}
      {isEmpty ? (
        <div className="room-page__not-found">
          <div className="room-page__not-found-title">{t('room.empty.title')}</div>
          <button
            type="button"
            className="room-page__not-found-link"
            onClick={() => void navigate('/')}
          >
            {t('room.backToHome')}
          </button>
        </div>
      ) : editMode ? (
        <SortableGrid
          items={orderedSectionDefs.map((s) => s.key)}
          onReorder={handleReorderSections}
          editMode={editMode}
          className="room-page__sections"
        >
          {orderedSectionDefs.map((s) => (
            <SortableSectionInner
              key={s.key}
              id={s.key}
              label={s.label}
              span={getRoomSpan(areaId, s.key, roomSectionSpans)}
              onCommitSpan={(newSpan) => handleSectionSpanChange(s.key, newSpan)}
            >
              {renderSectionContent(s)}
            </SortableSectionInner>
          ))}
        </SortableGrid>
      ) : (
        <div className="room-page__sections">
          {orderedSectionDefs.map((s) => (
            <section
              key={s.key}
              className={['room-page__section', roomSpanClass(getRoomSpan(areaId, s.key, roomSectionSpans))].join(' ')}
            >
              <SectionLabel>{s.label}</SectionLabel>
              {renderSectionContent(s)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
