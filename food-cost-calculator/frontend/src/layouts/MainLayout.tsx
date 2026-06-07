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
          maxWidth: '100%',
          margin: '0 auto',
          padding: '0 clamp(0.75rem, 2vw, 1.5rem)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            height: '60px',
            gap: '1rem',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              flex: '0 0 auto',
              minWidth: 0,
            }}>
              <h1 style={{ 
                color: 'var(--text-primary)', 
                fontSize: 'clamp(0.95rem, 1.5vw, 1.125rem)',
                fontWeight: '700',
                margin: 0,
                whiteSpace: 'nowrap',
              }}>
                🍽️ <span className="hidden sm:inline">FCC</span>
              </h1>
              <VenueSelector />
            </div>
            <div style={{ position: 'relative', flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end' }}>
              <Navigation />
            </div>
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
