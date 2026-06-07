import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authSlice';
import { useState } from 'react';

export const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const navLinkStyle = (path: string) => ({
    padding: '0.5rem 0.625rem',
    borderRadius: '0.375rem',
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: isActive(path) ? 'var(--primary-600)' : 'var(--text-secondary)',
    background: isActive(path) ? 'var(--primary-50)' : 'transparent',
    transition: 'all 0.15s ease-in-out',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center" style={{ gap: '0.375rem', flexWrap: 'nowrap' }}>
        <Link to="/dashboard" style={navLinkStyle('/dashboard')}>
          Dashboard
        </Link>
        <Link to="/ingredients" style={navLinkStyle('/ingredients')}>
          Ingredients
        </Link>
        <Link to="/recipes" style={navLinkStyle('/recipes')}>
          Recipes
        </Link>
        <Link to="/reports" style={navLinkStyle('/reports')}>
          Reports
        </Link>
        <Link to="/venues" style={navLinkStyle('/venues')}>
          Venues
        </Link>
        <Link to="/account" style={navLinkStyle('/account')}>
          Account
        </Link>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem',
          marginLeft: '0.5rem',
          paddingLeft: '0.75rem',
          borderLeft: '1px solid var(--border-light)',
          flexShrink: 0,
          flexWrap: 'nowrap',
        }}>
          <span style={{ 
            fontSize: '0.8125rem', 
            color: 'var(--text-secondary)',
            maxWidth: '120px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}>
            {user?.displayName || user?.email}
          </span>
          <button
            onClick={handleLogout}
            style={{
              padding: '0.375rem 0.625rem',
              fontSize: '0.8125rem',
              fontWeight: '500',
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: '1px solid var(--border-light)',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease-in-out',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
              e.currentTarget.style.borderColor = 'var(--border-medium)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border-light)';
            }}
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Mobile Menu Button */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden"
        style={{
          padding: '0.5rem',
          background: 'transparent',
          border: '1px solid var(--border-light)',
          borderRadius: '0.375rem',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {mobileMenuOpen ? (
          <svg style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div
          className="md:hidden"
          style={{
            position: 'absolute',
            top: '100%',
            right: '1rem',
            marginTop: '0.5rem',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-light)',
            borderRadius: '0.5rem',
            boxShadow: 'var(--shadow-lg)',
            padding: '0.5rem',
            minWidth: '200px',
            zIndex: 50,
          }}
        >
          <div style={{ 
            padding: '0.75rem', 
            borderBottom: '1px solid var(--border-light)',
            marginBottom: '0.5rem',
          }}>
            <div style={{ 
              fontSize: '0.875rem', 
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '0.25rem',
            }}>
              {user?.displayName || 'User'}
            </div>
            <div style={{ 
              fontSize: '0.75rem', 
              color: 'var(--text-tertiary)',
            }}>
              {user?.email}
            </div>
          </div>
          
          <Link 
            to="/dashboard" 
            onClick={() => setMobileMenuOpen(false)}
            style={{
              ...navLinkStyle('/dashboard'),
              display: 'block',
              marginBottom: '0.25rem',
            }}
          >
            Dashboard
          </Link>
          <Link 
            to="/ingredients"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              ...navLinkStyle('/ingredients'),
              display: 'block',
              marginBottom: '0.25rem',
            }}
          >
            Ingredients
          </Link>
          <Link 
            to="/recipes"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              ...navLinkStyle('/recipes'),
              display: 'block',
              marginBottom: '0.25rem',
            }}
          >
            Recipes
          </Link>
          <Link 
            to="/reports"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              ...navLinkStyle('/reports'),
              display: 'block',
              marginBottom: '0.25rem',
            }}
          >
            Reports
          </Link>
          <Link 
            to="/venues"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              ...navLinkStyle('/venues'),
              display: 'block',
              marginBottom: '0.25rem',
            }}
          >
            Venues
          </Link>
          <Link 
            to="/account"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              ...navLinkStyle('/account'),
              display: 'block',
              marginBottom: '0.5rem',
            }}
          >
            Account
          </Link>
          
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              handleLogout();
            }}
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              fontSize: '0.875rem',
              fontWeight: '500',
              color: 'var(--error)',
              background: 'var(--error-light)',
              border: '1px solid var(--error)',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              marginTop: '0.5rem',
            }}
          >
            Logout
          </button>
        </div>
      )}
    </>
  );
};
