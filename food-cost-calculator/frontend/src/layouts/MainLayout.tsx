import { Outlet } from 'react-router-dom';
import { VenueSelector } from '../components/VenueSelector';
import { Navigation } from '../components/Navigation';

export const MainLayout = () => {
  return (
    <div className="main-layout min-h-screen" style={{ background: 'var(--bg-secondary)' }}>
      <header style={{ 
        background: 'var(--bg-primary)', 
        borderBottom: '1px solid var(--border-light)',
        boxShadow: 'var(--shadow-sm)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}>
        <div style={{ 
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 clamp(1rem, 3vw, 2rem)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            height: 'clamp(56px, 8vh, 64px)',
            gap: 'clamp(1rem, 2vw, 2rem)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'clamp(1rem, 2vw, 1.5rem)',
              flex: '0 1 auto',
              minWidth: 0,
            }}>
              <h1 style={{ 
                color: 'var(--text-primary)', 
                fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                fontWeight: '700',
                margin: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                🍽️ <span className="hidden sm:inline">Food Cost Calculator</span><span className="sm:hidden">FCC</span>
              </h1>
              <div className="hidden md:block">
                <VenueSelector />
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <Navigation />
            </div>
          </div>
          
          {/* Mobile Venue Selector */}
          <div className="md:hidden" style={{ paddingBottom: '0.75rem' }}>
            <VenueSelector />
          </div>
        </div>
      </header>
      <main style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: 'clamp(1rem, 3vw, 2rem)',
      }}>
        <Outlet />
      </main>
    </div>
  );
};
