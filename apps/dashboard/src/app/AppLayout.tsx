/**
 * AppLayout — Daylight v2 shell.
 *
 * Desktop (≥900px): collapsible sidebar (240px expanded / 72px rail) + content area
 *                   with floating right-aligned header cluster.
 * Mobile (<900px):  full-screen content + fixed bottom tab bar (first 4 visible items + "More").
 *
 * Features:
 *  - Single nav config — sidebar + mobile tab bar derived from ONE NAV_CONFIG list.
 *  - Sidebar collapse: persisted via settingsStore.sidebarCollapsed.
 *  - Edit-mode nav editing: sortable sidebar nav with per-item hide badges.
 *  - Header summary chips on home route (desktop only, left of weather/bell/avatar).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import {
  Home,
  LayoutGrid,
  Cpu,
  Workflow,
  Activity,
  ShieldCheck,
  Sparkles,
  Music,
  Settings,
  Monitor,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Cloud,
  MoreHorizontal,
} from 'lucide-react';
import { PulseLogo } from '../components/ui/PulseLogo';
import { IconButton } from '../components/ui/IconButton';
import { UserAvatar } from '../components/ui/UserAvatar';
import { EditToggle } from '../components/ui/EditToggle';
import { RoomsMenu } from '../components/nav/RoomsMenu';
import { SortableGrid } from '../components/ui/SortableGrid';
import { SortableItem } from '../components/ui/SortableItem';
import { EditBadge } from '../components/ui/EditBadge';
import { SummaryChipsBar } from '../components/home/SummaryChipsBar';
import { WeatherModal } from '../components/home/chipmodals';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';
import { useConnectionStatus, useWeatherEntity, useCurrentUserAvatar } from '../ha/hooks';
import { useSettingsStore } from '../stores/settingsStore';
import { useEntityStore } from '../stores/entityStore';
import { useUIStore } from '../stores/uiStore';
import { applyStoredOrder } from '../lib/order';
import { useT } from '../i18n/useT';
import type { TKey } from '../i18n/useT';
import './AppLayout.css';

/* =========================================================
   Nav config — single source of truth
   ========================================================= */

/** Stable string IDs for each nav item. */
type NavId =
  | 'overview'
  | 'rooms'
  | 'devices'
  | 'automations'
  | 'energy'
  | 'security'
  | 'music'
  | 'scenes'
  | 'system'
  | 'settings';

interface NavConfigItem {
  id: NavId;
  icon: React.ReactNode;
  labelKey: TKey;
  /** Route path — omit for action items. */
  to?: string;
  /** For routes: only exact "/" is active. */
  exact?: boolean;
  /** Non-hideable items (overview + settings). */
  nonHideable?: boolean;
}

/**
 * The canonical ordered list of nav items.
 * Both sidebar and mobile tab bar are derived from this.
 */
const NAV_CONFIG: NavConfigItem[] = [
  { id: 'overview',    icon: <Home       size={20} strokeWidth={1.75} />, labelKey: 'nav.overview',    to: '/',            exact: true, nonHideable: true },
  { id: 'rooms',       icon: <LayoutGrid size={20} strokeWidth={1.75} />, labelKey: 'nav.rooms' },
  { id: 'devices',     icon: <Cpu        size={20} strokeWidth={1.75} />, labelKey: 'nav.devices',     to: '/devices' },
  { id: 'automations', icon: <Workflow   size={20} strokeWidth={1.75} />, labelKey: 'nav.automations', to: '/automations' },
  { id: 'energy',      icon: <Activity   size={20} strokeWidth={1.75} />, labelKey: 'nav.energy',      to: '/energy' },
  { id: 'security',    icon: <ShieldCheck size={20} strokeWidth={1.75} />, labelKey: 'nav.security',   to: '/security' },
  { id: 'music',       icon: <Music      size={20} strokeWidth={1.75} />, labelKey: 'nav.music',       to: '/music' },
  { id: 'scenes',      icon: <Sparkles   size={20} strokeWidth={1.75} />, labelKey: 'nav.scenes',      to: '/scenes' },
  { id: 'system',      icon: <Monitor    size={20} strokeWidth={1.75} />, labelKey: 'nav.system',      to: '/system' },
  { id: 'settings',    icon: <Settings   size={20} strokeWidth={1.75} />, labelKey: 'nav.settings',    to: '/settings',   nonHideable: true },
];

const ALL_NAV_IDS = NAV_CONFIG.map((item) => item.id);
const NAV_MAP = new Map<string, NavConfigItem>(NAV_CONFIG.map((item) => [item.id, item]));

/* =========================================================
   System status pill — sidebar footer, links to /system
   Separate component so entity updates don't re-render AppLayout.
   ========================================================= */

type SystemHealth = 'healthy' | 'warning' | 'critical' | 'unknown';

function SystemStatusPill() {
  const t = useT();
  const { entities, registries } = useEntityStore(
    useShallow((s) => ({ entities: s.entities, registries: s.registries }))
  );
  const hiddenNav      = useSettingsStore(useShallow((s) => s.customization.hiddenNav));
  const hiddenEntities = useSettingsStore(useShallow((s) => s.customization.hiddenEntities));

  // Identify System Monitor entities via registry platform field
  const systemMonitorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const re of (registries?.entities ?? [])) {
      if (re.platform === 'systemmonitor') ids.add(re.entity_id);
    }
    return ids;
  }, [registries]);

  const sysEntities = useMemo(
    () => Object.values(entities).filter((e) => systemMonitorIds.has(e.entity_id)),
    [entities, systemMonitorIds]
  );

  // All hooks above this line — early return only after all hooks
  if (hiddenNav.includes('system')) return null;

  const allEntities = Object.values(entities);

  // Key metrics (same patterns as SystemHeroCard)
  const cpu  = sysEntities.find((e) => /processor_use/.test(e.entity_id) && !/nice/.test(e.entity_id));
  const mem  = sysEntities.find((e) => /memory_use_percent/.test(e.entity_id));
  const disk = sysEntities.find((e) => /disk_use_percent/.test(e.entity_id));

  const cpuVal  = cpu  ? parseFloat(cpu.state)  : NaN;
  const memVal  = mem  ? parseFloat(mem.state)  : NaN;
  const diskVal = disk ? parseFloat(disk.state) : NaN;

  const hasMetrics = !isNaN(cpuVal) || !isNaN(memVal) || !isNaN(diskVal);

  const metricsCrit =
    (!isNaN(cpuVal) && cpuVal > 90) ||
    (!isNaN(memVal) && memVal > 90) ||
    (!isNaN(diskVal) && diskVal > 90);

  const metricsWarn =
    (!isNaN(cpuVal) && cpuVal > 75) ||
    (!isNaN(memVal) && memVal > 80) ||
    (!isNaN(diskVal) && diskVal > 80);

  const lowBatteries = allEntities.filter((e) =>
    e.entity_id.startsWith('sensor.') &&
    (e.attributes.device_class as string | undefined) === 'battery' &&
    !hiddenEntities.includes(e.entity_id) &&
    parseFloat(e.state) <= 20
  ).length;

  const unavailable = allEntities.filter(
    (e) => e.state === 'unavailable' && !hiddenEntities.includes(e.entity_id)
  ).length;

  const health: SystemHealth =
    metricsCrit                                            ? 'critical' :
    (metricsWarn || unavailable > 0 || lowBatteries > 0)  ? 'warning'  :
    hasMetrics                                             ? 'healthy'  : 'unknown';

  const statusTitle =
    metricsCrit                ? t('nav.systemStatus.critical') :
    metricsWarn                ? t('nav.systemStatus.warning') :
    unavailable > 0            ? t('nav.systemStatus.unavailable', { count: unavailable }) :
    lowBatteries > 0           ? t('nav.systemStatus.lowBattery', { count: lowBatteries }) :
    hasMetrics                 ? t('nav.systemStatus.healthy') : t('nav.systemStatus.unknown');

  const Icon =
    health === 'healthy'  ? CheckCircle2  :
    health === 'warning'  ? AlertTriangle :
    health === 'critical' ? AlertCircle   : Monitor;

  return (
    <NavLink
      to="/system"
      className={`home-status-pill home-status-pill--${health}`}
      aria-label={t('nav.systemStatus.ariaLabel', { status: statusTitle })}
    >
      <Icon size={16} strokeWidth={2} className="home-status-pill__icon" aria-hidden="true" />
      <div className="home-status-pill__text">
        <span className="home-status-pill__title">{statusTitle}</span>
        <span className="home-status-pill__sub">{t('nav.systemStatus.label')}</span>
      </div>
    </NavLink>
  );
}

/* =========================================================
   Weather glance (clickable button)
   ========================================================= */
interface WeatherGlanceProps {
  onClick: () => void;
}

function WeatherGlance({ onClick }: WeatherGlanceProps) {
  const t = useT();
  const weather = useWeatherEntity();
  if (!weather) return null;

  const temp = weather.attributes.temperature as number | undefined;
  const condition = weather.state as string;
  const unit = (weather.attributes.temperature_unit as string | undefined) ?? '°';
  const tempPart = temp != null ? `, ${temp}${unit}` : '';

  return (
    <button
      type="button"
      className="header-cluster__weather header-cluster__weather--btn"
      aria-label={t('nav.weatherGlance.ariaLabel', { condition, tempPart })}
      onClick={onClick}
    >
      <Cloud size={16} strokeWidth={1.75} aria-hidden="true" />
      {temp != null && (
        <span className="header-cluster__weather-temp">
          {Math.round(temp)}{unit}
        </span>
      )}
      <span className="header-cluster__weather-condition">{condition}</span>
    </button>
  );
}

/* =========================================================
   Right-aligned header cluster (chips + weather + bell + avatar)
   ========================================================= */
function HeaderCluster() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const avatarInfo = useCurrentUserAvatar();
  const editMode = useUIStore((s) => s.editMode);
  const isHome = location.pathname === '/';
  const isRoom = location.pathname.startsWith('/room/');

  const [weatherOpen, setWeatherOpen] = useState(false);

  return (
    <div className="header-cluster-wrapper">
      {/* Back button on room pages */}
      {isRoom && (
        <IconButton
          label={t('common.back')}
          size={40}
          variant="ghost"
          onClick={() => void navigate(-1)}
        >
          <ChevronLeft size={20} strokeWidth={1.75} />
        </IconButton>
      )}

      {/* Summary chips — desktop header, on every route. Suppressed only on the
          home route in edit mode, where the page shows an editable chips bar. */}
      {!(isHome && editMode) && (
        <SummaryChipsBar className="header-cluster__chips" />
      )}

      {/* Right-pinned weather + edit toggle (rooms) + bell + avatar */}
      <div className="header-cluster">
        <WeatherGlance onClick={() => setWeatherOpen(true)} />
        {isRoom && <EditToggle />}
        <NotificationsPanel />
        {avatarInfo && (
          <UserAvatar
            name={avatarInfo.name}
            pictureUrl={avatarInfo.pictureUrl}
            initial={avatarInfo.initial}
            interactive
          />
        )}
      </div>

      <WeatherModal open={weatherOpen} onClose={() => setWeatherOpen(false)} />
    </div>
  );
}

/* =========================================================
   Main component
   ========================================================= */
interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const t = useT();
  /* ---- Store reads ---- */
  const { status } = useConnectionStatus();
  const showBanner = status === 'reconnecting' || status === 'disconnected';
  const location = useLocation();

  // Separate selectors — no object/array literal that would need useShallow
  const navOrder   = useSettingsStore(useShallow((s) => s.customization.navOrder));
  const hiddenNav  = useSettingsStore(useShallow((s) => s.customization.hiddenNav));
  const sidebarCollapsed  = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const updateCustomization = useSettingsStore((s) => s.updateCustomization);
  const appName = useSettingsStore((s) => s.appName);
  const appIcon = useSettingsStore((s) => s.appIcon);
  const appIconHidden = useSettingsStore((s) => s.appIconHidden);

  const editMode = useUIStore((s) => s.editMode);

  /* ---- Derived nav order ---- */
  // All IDs in user-stored order (new IDs appended after stored ones)
  const orderedIds = applyStoredOrder(ALL_NAV_IDS, navOrder);

  /* ---- Rooms popover state ---- */
  const isRoomsActive = location.pathname.startsWith('/room');
  const [roomsOpen, setRoomsOpen] = useState(false);
  const sidebarRoomsRef = useRef<HTMLButtonElement>(null);
  const tabRoomsRef = useRef<HTMLButtonElement>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);

  const toggleRooms = useCallback(() => setRoomsOpen((prev) => !prev), []);
  const closeRooms  = useCallback(() => setRoomsOpen(false), []);

  /* ---- More menu state (mobile tab bar overflow) ---- */
  const [moreOpen, setMoreOpen] = useState(false);
  const tabMoreRef  = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const handleMoreClose  = useCallback(() => setMoreOpen(false), []);
  const handleMoreToggle = useCallback(() => setMoreOpen((prev) => !prev), []);

  // Close More on outside click / Escape
  useEffect(() => {
    if (!moreOpen) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (
        moreMenuRef.current && !moreMenuRef.current.contains(t) &&
        tabMoreRef.current  && !tabMoreRef.current.contains(t)
      ) {
        setMoreOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        tabMoreRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  // Close More on route change
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const handleSidebarRoomsClick = useCallback(() => {
    activeTriggerRef.current = sidebarRoomsRef.current;
    if (sidebarRoomsRef.current) {
      const rect = sidebarRoomsRef.current.getBoundingClientRect();
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - 200));
      document.documentElement.style.setProperty('--rooms-menu-top', `${top}px`);
    }
    toggleRooms();
  }, [toggleRooms]);

  const handleTabRoomsClick = useCallback(() => {
    activeTriggerRef.current = tabRoomsRef.current;
    toggleRooms();
  }, [toggleRooms]);

  /* ---- Edit-mode nav handlers ---- */
  const handleNavReorder = useCallback(
    (newIds: string[]) => {
      updateCustomization({ navOrder: newIds });
    },
    [updateCustomization],
  );

  const handleToggleHidden = useCallback(
    (id: string) => {
      const next = hiddenNav.includes(id)
        ? hiddenNav.filter((x) => x !== id)
        : [...hiddenNav, id];
      updateCustomization({ hiddenNav: next });
    },
    [hiddenNav, updateCustomization],
  );

  /* ---- Collapse toggle ---- */
  const handleCollapseToggle = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  /* ---- Render helpers ---- */

  function renderSidebarItem(id: string, isFirst: boolean, isLast: boolean) {
    const item = NAV_MAP.get(id);
    if (!item) return null;

    const isHidden = hiddenNav.includes(id);
    // In non-edit mode, skip hidden items
    if (!editMode && isHidden) return null;

    const isAction = !item.to;
    const isRoomsBtn = id === 'rooms';
    const isActive = isRoomsBtn
      ? isRoomsActive || roomsOpen
      : false; // NavLink handles active state for routes

    const label = t(item.labelKey);
    const icon = item.icon;

    const wrapperCls = [
      'sidebar-nav__item-wrapper',
      editMode && isHidden ? 'sidebar-nav__item-wrapper--hidden' : '',
    ].filter(Boolean).join(' ');

    if (!editMode) {
      // Normal (non-edit) rendering
      if (isAction) {
        return (
          <li key={id}>
            <button
              ref={isRoomsBtn ? sidebarRoomsRef : undefined}
              type="button"
              className={[
                'sidebar-nav__item',
                'sidebar-nav__item--button',
                isActive ? 'sidebar-nav__item--active' : '',
              ].filter(Boolean).join(' ')}
              aria-label={label}
              aria-haspopup="menu"
              aria-expanded={isRoomsBtn ? roomsOpen : undefined}
              onClick={isRoomsBtn ? handleSidebarRoomsClick : undefined}
              title={sidebarCollapsed ? label : undefined}
            >
              <span className="sidebar-nav__icon" aria-hidden="true">{icon}</span>
              <span className="sidebar-nav__label">{label}</span>
            </button>
          </li>
        );
      }
      return (
        <li key={id}>
          <NavLink
            to={item.to!}
            end={item.exact === true}
            className={({ isActive: navActive }) =>
              ['sidebar-nav__item', navActive ? 'sidebar-nav__item--active' : ''].filter(Boolean).join(' ')
            }
            title={sidebarCollapsed ? label : undefined}
          >
            <span className="sidebar-nav__icon" aria-hidden="true">{icon}</span>
            <span className="sidebar-nav__label">{label}</span>
          </NavLink>
        </li>
      );
    }

    // Edit mode rendering — disable navigation, show badge
    const canHide = !item.nonHideable;
    const itemCls = [
      'sidebar-nav__item',
      isAction ? 'sidebar-nav__item--button' : '',
      'sidebar-nav__item--edit',
      isHidden ? 'sidebar-nav__item--dimmed' : '',
    ].filter(Boolean).join(' ');

    return (
      <SortableItem key={id} id={id} editMode>
        <li className={wrapperCls} style={{ listStyle: 'none' }}>
          {/* Use a div/button that doesn't navigate in edit mode */}
          <div
            className={itemCls}
            role="button"
            tabIndex={-1}
            aria-label={label}
          >
            <span className="sidebar-nav__icon" aria-hidden="true">{icon}</span>
            <span className="sidebar-nav__label">{label}</span>
          </div>
          {canHide && (
            <EditBadge
              hidden={isHidden}
              toggleLabel={isHidden ? t('nav.editBadge.show', { label }) : t('nav.editBadge.hide', { label })}
              onToggleHidden={() => handleToggleHidden(id)}
            />
          )}
        </li>
      </SortableItem>
    );
  }

  /* ---- Mobile tab bar ---- */
  // All visible nav items in user order. If ≤5, show them all; if >5 show first 4 + "More".
  const allVisibleIds = orderedIds.filter((id) => !hiddenNav.includes(id));
  const showMore      = allVisibleIds.length > 5;
  const primaryTabIds = showMore ? allVisibleIds.slice(0, 4) : allVisibleIds;
  const moreTabIds    = showMore ? allVisibleIds.slice(4)    : [];

  function renderMobileTab(id: string) {
    const item = NAV_MAP.get(id);
    if (!item) return null;

    const isAction  = !item.to;
    const isRoomsBtn = id === 'rooms';
    const isActive  = isRoomsBtn ? isRoomsActive || roomsOpen : false;
    const label = t(item.labelKey);

    if (isAction) {
      return (
        <button
          key={id}
          ref={isRoomsBtn ? tabRoomsRef : undefined}
          type="button"
          className={['app-tabs__item', isActive ? 'app-tabs__item--active' : ''].filter(Boolean).join(' ')}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={isRoomsBtn ? roomsOpen : undefined}
          onClick={isRoomsBtn ? handleTabRoomsClick : undefined}
        >
          {item.icon}
          <span className="app-tabs__label">{label}</span>
        </button>
      );
    }

    return (
      <NavLink
        key={id}
        to={item.to!}
        end={item.exact === true}
        className={({ isActive: navActive }) =>
          ['app-tabs__item', navActive ? 'app-tabs__item--active' : ''].filter(Boolean).join(' ')
        }
      >
        {item.icon}
        <span className="app-tabs__label">{label}</span>
      </NavLink>
    );
  }

  /** Render a row inside the More dropdown */
  function renderMoreRow(id: string) {
    const item = NAV_MAP.get(id);
    if (!item) return null;

    const isRoomsBtn = id === 'rooms';
    const isAction   = !item.to;
    const label = t(item.labelKey);

    if (isAction) {
      return (
        <button
          key={id}
          type="button"
          role="menuitem"
          className="app-more-menu__row"
          onClick={() => {
            handleMoreClose();
            if (isRoomsBtn) {
              activeTriggerRef.current = tabMoreRef.current;
              toggleRooms();
            }
          }}
        >
          <span className="app-more-menu__row-icon" aria-hidden="true">{item.icon}</span>
          <span className="app-more-menu__row-name">{label}</span>
          <ChevronRight size={16} strokeWidth={1.75} className="app-more-menu__row-chevron" aria-hidden="true" />
        </button>
      );
    }

    return (
      <NavLink
        key={id}
        to={item.to!}
        end={item.exact === true}
        role="menuitem"
        className={({ isActive: navActive }) =>
          ['app-more-menu__row', navActive ? 'app-more-menu__row--active' : ''].filter(Boolean).join(' ')
        }
        onClick={handleMoreClose}
      >
        <span className="app-more-menu__row-icon" aria-hidden="true">{item.icon}</span>
        <span className="app-more-menu__row-name">{label}</span>
        <ChevronRight size={16} strokeWidth={1.75} className="app-more-menu__row-chevron" aria-hidden="true" />
      </NavLink>
    );
  }

  /* ---- Sidebar width CSS var — for RoomsMenu offset and content margin ---- */
  const sidebarWidth = sidebarCollapsed ? 72 : 240;

  return (
    <div
      className={[
        'app-layout',
        sidebarCollapsed ? 'app-layout--sidebar-collapsed' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* ---- Desktop sidebar ---- */}
      <nav
        className={[
          'app-sidebar',
          sidebarCollapsed ? 'app-sidebar--collapsed' : '',
        ].filter(Boolean).join(' ')}
        aria-label={t('nav.mainNavigation')}
      >
        {/* Logo / wordmark */}
        <div className="app-sidebar__header">
          <PulseLogo
            size={32}
            wordmark={!sidebarCollapsed}
            name={appName || 'HAPulse'}
            icon={appIcon}
            hideIcon={appIconHidden}
          />
        </div>

        {/* Nav list */}
        <SortableGrid
          items={orderedIds}
          onReorder={handleNavReorder}
          className="sidebar-nav"
          editMode={editMode}
        >
          <ul className="sidebar-nav__list" role="list">
            {orderedIds.map((id, idx) =>
              renderSidebarItem(id, idx === 0, idx === orderedIds.length - 1)
            )}
          </ul>
        </SortableGrid>

        {/* Bottom status area */}
        <div className="app-sidebar__footer">
          <SystemStatusPill />

          {/* Collapse button */}
          <button
            type="button"
            className="app-sidebar__collapse"
            aria-label={sidebarCollapsed ? t('nav.sidebarExpand') : t('nav.sidebarCollapse')}
            aria-expanded={!sidebarCollapsed}
            onClick={handleCollapseToggle}
            title={sidebarCollapsed ? t('nav.sidebarExpand') : t('nav.sidebarCollapse')}
          >
            {sidebarCollapsed
              ? <ChevronRight size={16} strokeWidth={2} />
              : <ChevronLeft  size={16} strokeWidth={2} />
            }
          </button>
        </div>
      </nav>

      {/* Rooms popover (rendered outside sidebar so it can overlap content) */}
      <RoomsMenu
        open={roomsOpen}
        onClose={closeRooms}
        triggerRef={activeTriggerRef}
      />

      {/* More menu — mobile-only bottom-sheet for overflow nav items */}
      <div
        ref={moreMenuRef}
        className={`app-more-menu${moreOpen ? ' app-more-menu--open' : ''}`}
        role="menu"
        aria-label={t('nav.moreNavigation')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="app-more-menu__inner">
          {moreTabIds.map(renderMoreRow)}
        </div>
      </div>

      {/* ---- Content area ---- */}
      <div className="app-content">
        {/* Connection status banner */}
        {showBanner && (
          <div
            className={`app-banner app-banner--${status === 'reconnecting' ? 'warning' : 'error'}`}
            role="status"
            aria-live="polite"
          >
            {status === 'reconnecting'
              ? t('banner.reconnecting')
              : t('banner.disconnected')}
          </div>
        )}

        {/* Floating header — desktop only (chips + weather + bell + avatar) */}
        <div className="app-header-cluster-wrapper" aria-label={t('nav.quickActions')}>
          <HeaderCluster />
        </div>

        {/* Mobile-only summary chips at the top — every route except home
            (home renders its own chips bar inline). */}
        {location.pathname !== '/' && (
          <SummaryChipsBar className="app-chips-mobile" />
        )}

        <main className="app-main">
          {children}
        </main>
      </div>

      {/* ---- Mobile bottom tab bar ---- */}
      <nav className="app-tabs" aria-label={t('nav.mainNavigation')}>
        {primaryTabIds.map(renderMobileTab)}
        {showMore && (
          <button
            ref={tabMoreRef}
            type="button"
            className={`app-tabs__item${moreOpen ? ' app-tabs__item--active' : ''}`}
            onClick={handleMoreToggle}
            aria-label={t('nav.moreNavigation')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal size={20} strokeWidth={1.75} />
            <span className="app-tabs__label">{t('nav.more')}</span>
          </button>
        )}
      </nav>
    </div>
  );
}
