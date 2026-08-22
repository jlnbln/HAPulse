import React, { useCallback, useMemo, useState } from 'react';
import { Scaling } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AutomationHeroCard } from '../components/automation/AutomationHeroCard';
import { AutomationActivityFeed } from '../components/automation/AutomationActivityFeed';
import { AutomationCategoryCard } from '../components/automation/AutomationCategoryCard';
import { SortableGrid } from '../components/ui/SortableGrid';
import { SortableItem } from '../components/ui/SortableItem';
import { EditBadge } from '../components/ui/EditBadge';
import { HeightHandle, HeightDots, heightClass, getHeightLevel } from '../components/ui/SectionResize';
import { EditToggle } from '../components/ui/EditToggle';
import { PageHeaderActions } from '../components/ui/PageHeaderActions';
import { useT, useLocale, type TKey, type TFunction } from '../i18n/useT';
import { useEntitiesByDomain } from '../ha/hooks';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useEntityStore } from '../stores/entityStore';
import { AutomationsToolbar, type FilterOption } from '../components/automation/AutomationsToolbar';
import { applyStoredOrder } from '../lib/order';
import type { HassEntity } from '@hapulse/core';
import './Page.css';
import './Automations.css';

// ── Category helpers ──────────────────────────────────────────────────────────

function getCategory(entity: HassEntity): string {
  const cat = entity.attributes.category as string | undefined;
  if (cat) return cat;
  const suffix = entity.entity_id.slice('automation.'.length);
  const first  = suffix.split('_')[0] ?? '';
  return first.length > 1
    ? first.charAt(0).toUpperCase() + first.slice(1)
    : 'General';
}

function categoryToId(cat: string): string {
  return `cat_${cat.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
}

function idToCategory(sectionId: string, categories: string[]): string {
  const slug = sectionId.slice('cat_'.length);
  return (
    categories.find((c) => c.toLowerCase().replace(/\s+/g, '_') === slug) ??
    (slug.charAt(0).toUpperCase() + slug.slice(1))
  );
}

/** Display-only translation of the `'General'` fallback category. The raw
 *  `'General'` string is what `categoryToId()` persists as a section id, so it
 *  must stay untranslated at the source — only render call sites go through
 *  this helper (mirrors Scenes.tsx's `scenes.section.generalLabel`). */
function categoryDisplayLabel(t: TFunction, category: string): string {
  return category === 'General' ? t('automations.section.generalLabel') : category;
}

// ── Column-span system (mirrors Home.tsx) ─────────────────────────────────────

const MAX_COLS = 4;

const DEFAULT_SPANS: Record<string, number> = {
  hero:     2,
  activity: 2,
};

function getSpan(id: string, stored: Record<string, number>): number {
  return stored[id] ?? DEFAULT_SPANS[id] ?? 1;
}

function spanClass(span: number): string {
  if (span >= 4) return 'overview-grid__cell--span-4';
  if (span === 3) return 'overview-grid__cell--span-3';
  if (span === 2) return 'overview-grid__cell--span-2';
  return '';
}

// ── Span dots ─────────────────────────────────────────────────────────────────

function SpanDots({ span }: { span: number }) {
  return (
    <div className="overview-span-dots" aria-hidden="true">
      {Array.from({ length: MAX_COLS }, (_, i) => (
        <span
          key={i}
          className={`overview-span-dot${i < span ? ' overview-span-dot--filled' : ''}`}
        />
      ))}
    </div>
  );
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({
  id,
  span,
  onCommit,
}: {
  id: string;
  span: number;
  onCommit: (id: string, newSpan: number) => void;
}) {
  const t = useT();

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();

    const btn = e.currentTarget;
    btn.setPointerCapture(e.pointerId);

    const sectionEl = btn.closest('[data-section]') as HTMLElement | null;
    const gridEl    = btn.closest('.overview-grid') as HTMLElement | null;
    if (!sectionEl || !gridEl) return;

    const gridItem  = sectionEl.parentElement as HTMLElement;
    const colWidth  = gridEl.getBoundingClientRect().width / MAX_COLS;
    const startX    = e.clientX;
    const startSpan = span;
    let previewSpan = startSpan;

    function onMove(me: PointerEvent) {
      const delta = Math.round((me.clientX - startX) / colWidth);
      const next  = Math.max(1, Math.min(MAX_COLS, startSpan + delta));
      if (next !== previewSpan) {
        previewSpan = next;
        gridItem.style.gridColumn =
          next >= MAX_COLS ? '1 / -1' : next > 1 ? `span ${next}` : '';
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      gridItem.style.gridColumn = '';
      onCommit(id, previewSpan);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  return (
    <button
      type="button"
      className="overview-resize-handle"
      onPointerDown={handlePointerDown}
      aria-label={t('columnResize.ariaLabel', { span, max: MAX_COLS })}
      title={t('columnResize.title', { span, max: MAX_COLS })}
    >
      <Scaling size={12} strokeWidth={2.5} />
    </button>
  );
}

// ── Section labels for EditBadge ──────────────────────────────────────────────

type ToggleKeys = { hide: TKey; show: TKey; hideMobile: TKey; showMobile: TKey };

const FIXED_TOGGLE_KEYS: Record<string, ToggleKeys> = {
  hero: {
    hide: 'automations.section.hide.hero',
    show: 'automations.section.show.hero',
    hideMobile: 'automations.section.hideMobile.hero',
    showMobile: 'automations.section.showMobile.hero',
  },
  activity: {
    hide: 'automations.section.hide.activity',
    show: 'automations.section.show.activity',
    hideMobile: 'automations.section.hideMobile.activity',
    showMobile: 'automations.section.showMobile.activity',
  },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function Automations() {
  const t = useT();
  const locale = useLocale();
  const automations = useEntitiesByDomain('automation');
  const editMode    = useUIStore((s) => s.editMode);
  const registries  = useEntityStore((s) => s.registries);

  const automationSectionOrder = useSettingsStore(
    useShallow((s) => s.customization.automationSectionOrder)
  );
  const hiddenAutomationSections = useSettingsStore(
    useShallow((s) => s.customization.hiddenAutomationSections)
  );
  const mobileHiddenAutomationSections = useSettingsStore(
    useShallow((s) => s.customization.mobileHiddenAutomationSections)
  );
  const automationSectionSpans = useSettingsStore(
    useShallow((s) => s.customization.automationSectionSpans)
  );
  const automationSectionHeights = useSettingsStore(
    useShallow((s) => s.customization.automationSectionHeights)
  );
  const updateCustomization = useSettingsStore((s) => s.updateCustomization);

  // Derive categories from live automation entities
  const categories = [...new Set(automations.map(getCategory))].sort();
  const categoryIds = categories.map(categoryToId);

  // ── Search / filter state ─────────────────────────────────────────────────
  const [search, setSearch]               = useState('');
  const [roomFilter, setRoomFilter]       = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Build automation→area mapping and room dropdown options from registries
  const { roomOptions, automationArea } = useMemo(() => {
    const areaName  = new Map((registries?.areas   ?? []).map((a) => [a.area_id, a.name]));
    const deviceArea = new Map((registries?.devices ?? []).map((d) => [d.id, d.area_id ?? null]));
    const entById   = new Map((registries?.entities ?? []).map((e) => [e.entity_id, e]));

    const areaOf = (id: string): string | null => {
      const re = entById.get(id);
      if (!re) return null;
      return re.area_id ?? (re.device_id ? (deviceArea.get(re.device_id) ?? null) : null);
    };

    const map: Record<string, string | null> = {};
    const present = new Set<string>();
    for (const a of automations) {
      const ar = areaOf(a.entity_id);
      map[a.entity_id] = ar;
      if (ar) present.add(ar);
    }

    const opts: FilterOption[] = [...present]
      .map((id) => ({ value: id, label: areaName.get(id) ?? id }))
      .sort((x, y) => x.label.localeCompare(y.label, locale));

    return { roomOptions: opts, automationArea: map };
  }, [registries, automations, locale]);

  // Category dropdown options derived from the existing `categories` array
  const categoryOptions: FilterOption[] = categories.map((c) => ({ value: c, label: categoryDisplayLabel(t, c) }));

  // Whether any filter is active (controls flat-list vs. section grid)
  const filterActive = search.trim() !== '' || roomFilter !== '' || categoryFilter !== '';

  // Filtered automation list used when filterActive && !editMode
  const filteredAutomations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return automations.filter((a) => {
      if (categoryFilter && getCategory(a) !== categoryFilter) return false;
      if (roomFilter && automationArea[a.entity_id] !== roomFilter) return false;
      if (q) {
        const name = (a.attributes.friendly_name as string | undefined) ?? a.entity_id;
        const hay = `${name} ${a.entity_id} ${getCategory(a)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [automations, search, roomFilter, categoryFilter, automationArea]);

  const allSectionIds = ['hero', 'activity', ...categoryIds];
  const orderedIds    = applyStoredOrder(allSectionIds, automationSectionOrder);

  const visibleIds = editMode
    ? orderedIds
    : orderedIds.filter((id) => !hiddenAutomationSections.includes(id));

  function handleToggleHidden(id: string) {
    const next = hiddenAutomationSections.includes(id)
      ? hiddenAutomationSections.filter((s) => s !== id)
      : [...hiddenAutomationSections, id];
    updateCustomization({ hiddenAutomationSections: next });
  }

  function handleToggleMobileHidden(id: string) {
    const next = mobileHiddenAutomationSections.includes(id)
      ? mobileHiddenAutomationSections.filter((s) => s !== id)
      : [...mobileHiddenAutomationSections, id];
    updateCustomization({ mobileHiddenAutomationSections: next });
  }

  const handleSpanChange = useCallback(
    (id: string, newSpan: number) => {
      updateCustomization({
        automationSectionSpans: { ...automationSectionSpans, [id]: newSpan },
      });
    },
    [automationSectionSpans, updateCustomization]
  );

  const handleHeightChange = useCallback(
    (id: string, newLevel: number) => {
      updateCustomization({
        automationSectionHeights: { ...automationSectionHeights, [id]: newLevel },
      });
    },
    [automationSectionHeights, updateCustomization]
  );

  const handleReorder = useCallback(
    (newOrder: string[]) => {
      updateCustomization({ automationSectionOrder: newOrder });
    },
    [updateCustomization]
  );

  function getToggleLabels(id: string) {
    const fixed = FIXED_TOGGLE_KEYS[id];
    if (fixed) {
      return {
        hide: t(fixed.hide),
        show: t(fixed.show),
        hideMobile: t(fixed.hideMobile),
        showMobile: t(fixed.showMobile),
      };
    }
    const label = categoryDisplayLabel(t, idToCategory(id, categories));
    return {
      hide: t('automations.section.hideCategory', { label }),
      show: t('automations.section.showCategory', { label }),
      hideMobile: t('automations.section.hideMobileCategory', { label }),
      showMobile: t('automations.section.showMobileCategory', { label }),
    };
  }

  function renderWidget(id: string) {
    if (id === 'hero') {
      return <AutomationHeroCard automations={automations} categories={categories} />;
    }
    if (id === 'activity') {
      return <AutomationActivityFeed automations={automations} />;
    }
    const catName  = idToCategory(id, categories);
    const catAutos = automations.filter((e) => getCategory(e) === catName);
    return <AutomationCategoryCard category={categoryDisplayLabel(t, catName)} automations={catAutos} />;
  }

  return (
    <div className="page automations-page stagger-rise">
      <div className="page__header-row automations-page__header">
        <h1 className="page__title">{t('automations.title')}</h1>
        <PageHeaderActions><EditToggle /></PageHeaderActions>
      </div>

      {!editMode && (
        <AutomationsToolbar
          search={search}
          onSearchChange={setSearch}
          rooms={roomOptions}
          room={roomFilter}
          onRoomChange={setRoomFilter}
          categories={categoryOptions}
          category={categoryFilter}
          onCategoryChange={setCategoryFilter}
        />
      )}

      {!editMode && filterActive ? (
        filteredAutomations.length === 0 ? (
          <p className="automations-empty-filter">{t('automations.emptyFilter')}</p>
        ) : (
          <div className="overview-grid">
            {[...new Set(filteredAutomations.map(getCategory))].sort().map((cat) => (
              <div key={cat} className="overview-grid__cell overview-grid__cell--span-2">
                <AutomationCategoryCard
                  category={categoryDisplayLabel(t, cat)}
                  automations={filteredAutomations.filter((a) => getCategory(a) === cat)}
                />
              </div>
            ))}
          </div>
        )
      ) : (
        <SortableGrid
          items={visibleIds}
          onReorder={handleReorder}
          editMode={editMode}
          className="overview-grid"
        >
          {visibleIds.map((id) => {
            const isHidden       = hiddenAutomationSections.includes(id);
            const isMobileHidden = mobileHiddenAutomationSections.includes(id);
            const currentSpan = getSpan(id, automationSectionSpans);
            const sc          = spanClass(currentSpan);
            const currentHeight = getHeightLevel(id, automationSectionHeights);
            const hc            = heightClass(currentHeight);
            const widget      = renderWidget(id);

            if (!editMode) {
              const cellClass = [
                'overview-grid__cell',
                sc,
                hc,
                isHidden ? 'overview-grid__cell--hidden' : '',
                isMobileHidden ? 'section-mobile-hidden' : '',
              ].filter(Boolean).join(' ');

              return (
                <div key={id} className={cellClass} data-section={id}>
                  {widget}
                </div>
              );
            }

            const cellClass = [
              'overview-grid__cell',
              'overview-grid__cell--editing',
              hc,
              isHidden ? 'overview-grid__cell--hidden' : '',
            ].filter(Boolean).join(' ');

            return (
              <SortableItem key={id} id={id} editMode={editMode} className={sc}>
                <div className={cellClass} data-section={id}>
                  <div className="edit-section-outline">{widget}</div>
                  <EditBadge
                    hidden={isHidden}
                    toggleLabel={isHidden ? getToggleLabels(id).show : getToggleLabels(id).hide}
                    onToggleHidden={() => handleToggleHidden(id)}
                    mobileHidden={isMobileHidden}
                    onToggleMobileHidden={() => handleToggleMobileHidden(id)}
                    mobileToggleLabel={
                      isMobileHidden ? getToggleLabels(id).showMobile : getToggleLabels(id).hideMobile
                    }
                  />
                  <SpanDots span={currentSpan} />
                  <ResizeHandle id={id} span={currentSpan} onCommit={handleSpanChange} />
                  <HeightDots level={currentHeight} />
                  <HeightHandle id={id} level={currentHeight} onCommit={handleHeightChange} />
                </div>
              </SortableItem>
            );
          })}
        </SortableGrid>
      )}
    </div>
  );
}
