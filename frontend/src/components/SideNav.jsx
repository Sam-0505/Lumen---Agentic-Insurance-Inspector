import { enableXRLayer } from '../lib/enableXRLayer';
import { useIsMobile } from '../lib/useIsMobile';

const inWebSpatial = /WebSpatial\//.test(navigator.userAgent);

// Side navigation — matches the dark vertical pill from Figma
// Collapsed (icon-only) on narrow screens, expanded with labels otherwise

const NAV_ITEMS = [
  {
    id: 'new',
    label: 'New Inspection',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'My Tasks',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: 'gallery',
    label: 'Gallery',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
  },
  {
    id: 'report',
    label: 'Generate Report',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
];

const EXIT_ITEM = {
  id: 'exit',
  label: 'Exit App',
  icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
};

export default function SideNav({ active, onNavigate = () => {}, expanded = true }) {
  // On phones the rail would sit on top of the claim cards, and it navigates
  // nowhere yet, so it's dropped entirely rather than collapsed.
  const isMobile = useIsMobile();
  if (isMobile) return null;

  const navStyle = {
    position: 'fixed',
    left: 20,
    top: '38%',
    transform: inWebSpatial
      ? 'translateY(-50%) perspective(800px) rotateY(18deg) translateZ(80px) translateY(-100px)'
      : 'translateY(-25%)',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(93,93,93,0.80)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
    ...enableXRLayer({ zOffset: 0.8, backgroundMaterial: 'translucent' }),
    padding: '10px 0',
    minWidth: expanded ? 220 : 62,
    transition: 'min-width 0.2s ease',
    overflow: 'hidden',
  };

  return (
    <nav style={navStyle}>
      {NAV_ITEMS.map(item => (
        <NavItem
          key={item.id}
          item={item}
          isActive={active === item.id}
          expanded={expanded}
          onClick={() => onNavigate(item.id)}
        />
      ))}

      {/* Spacer */}
      <div style={{ flex: 1, minHeight: 20 }} />

      <NavItem
        item={EXIT_ITEM}
        isActive={false}
        expanded={expanded}
        onClick={() => onNavigate('exit')}
      />

      {/* Bottom pill indicator */}
      <div style={{
        width: 36, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.25)',
        margin: '10px auto 6px',
      }} />
    </nav>
  );
}

function NavItem({ item, isActive, expanded, onClick }) {
  return (
    <button
      className="spatial-btn"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: expanded ? '12px 18px' : '13px',
        margin: '2px 8px',
        borderRadius: 12,
        background: isActive ? 'rgba(80,80,80,0.85)' : 'transparent',
        color: 'white',
        fontSize: 15,
        fontWeight: isActive ? 600 : 400,
        transition: 'background 0.15s',
        whiteSpace: 'nowrap',
        justifyContent: expanded ? 'flex-start' : 'center',
        fontFamily: 'var(--font)',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ flexShrink: 0 }}>{item.icon}</span>
      {expanded && <span>{item.label}</span>}
    </button>
  );
}
