import { Outlet } from 'react-router-dom';

export const AuthLayout = () => {
  return (
    <div className="auth-layout min-h-screen" style={{ background: '#f3f4f6', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Left side - Form */}
      <div 
        className="flex items-center justify-center py-12"
        style={{
          background: 'white',
          padding: '3rem 4rem',
        }}
      >
        <div className="w-full fade-in" style={{ maxWidth: '520px' }}>
          <Outlet />
        </div>
      </div>
      
      {/* Right side - Branding */}
      <div 
        className="flex items-center justify-center relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
          position: 'relative',
          padding: '4rem 3rem',
        }}
      >
        {/* Decorative circles - responsive sizes */}
        <div style={{
          position: 'absolute',
          width: 'clamp(300px, 40vw, 500px)',
          height: 'clamp(300px, 40vw, 500px)',
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.1)',
          top: '-10%',
          right: '-10%',
          filter: 'blur(3px)',
        }} />
        <div style={{
          position: 'absolute',
          width: 'clamp(200px, 30vw, 350px)',
          height: 'clamp(200px, 30vw, 350px)',
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.1)',
          bottom: '-10%',
          left: '-10%',
          filter: 'blur(2px)',
        }} />
        
        <div className="text-white relative z-10 slide-in-right" style={{ 
          maxWidth: '600px',
          width: '100%',
          padding: '0 2rem',
        }}>
          {/* Logo/Brand Icon */}
          <div style={{
            width: 'clamp(56px, 5vw, 72px)',
            height: 'clamp(56px, 5vw, 72px)',
            borderRadius: '1rem',
            background: 'rgba(255, 255, 255, 0.2)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
            marginBottom: 'clamp(1.5rem, 2vw, 2rem)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          }}>
            🍽️
          </div>
          
          <h1 style={{ 
            fontSize: 'clamp(2rem, 3vw, 2.75rem)',
            fontWeight: '800', 
            marginBottom: 'clamp(0.75rem, 1vw, 1.25rem)',
            color: 'white',
            lineHeight: '1.2',
            letterSpacing: '-0.02em'
          }}>
            Food Cost Calculator
          </h1>
          
          <p style={{ 
            fontSize: 'clamp(1rem, 1.2vw, 1.125rem)',
            lineHeight: '1.7',
            color: 'rgba(255, 255, 255, 0.9)',
            marginBottom: 'clamp(2rem, 2.5vw, 2.5rem)',
            fontWeight: '400'
          }}>
            Take control of your restaurant's profitability with precise cost tracking and recipe management.
          </p>
          
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 'clamp(1.25rem, 1.5vw, 1.5rem)' 
          }}>
            {/* Feature 1 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'clamp(0.75rem, 1vw, 1rem)' }}>
              <div style={{
                width: 'clamp(36px, 3vw, 44px)',
                height: 'clamp(36px, 3vw, 44px)',
                borderRadius: '0.5rem',
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg style={{ width: 'clamp(18px, 2vw, 22px)', height: 'clamp(18px, 2vw, 22px)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ 
                  fontWeight: '600', 
                  marginBottom: '0.375rem', 
                  fontSize: 'clamp(0.9375rem, 1.1vw, 1.0625rem)' 
                }}>
                  Real-time Cost Tracking
                </h3>
                <p style={{ 
                  color: 'rgba(255, 255, 255, 0.8)', 
                  fontSize: 'clamp(0.875rem, 1vw, 0.9375rem)', 
                  lineHeight: '1.6' 
                }}>
                  Monitor ingredient prices and recipe costs as they change
                </p>
              </div>
            </div>
            
            {/* Feature 2 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'clamp(0.75rem, 1vw, 1rem)' }}>
              <div style={{
                width: 'clamp(36px, 3vw, 44px)',
                height: 'clamp(36px, 3vw, 44px)',
                borderRadius: '0.5rem',
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg style={{ width: 'clamp(18px, 2vw, 22px)', height: 'clamp(18px, 2vw, 22px)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ 
                  fontWeight: '600', 
                  marginBottom: '0.375rem', 
                  fontSize: 'clamp(0.9375rem, 1.1vw, 1.0625rem)' 
                }}>
                  Multi-venue Support
                </h3>
                <p style={{ 
                  color: 'rgba(255, 255, 255, 0.8)', 
                  fontSize: 'clamp(0.875rem, 1vw, 0.9375rem)', 
                  lineHeight: '1.6' 
                }}>
                  Manage multiple restaurant locations from a single dashboard
                </p>
              </div>
            </div>
            
            {/* Feature 3 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'clamp(0.75rem, 1vw, 1rem)' }}>
              <div style={{
                width: 'clamp(36px, 3vw, 44px)',
                height: 'clamp(36px, 3vw, 44px)',
                borderRadius: '0.5rem',
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg style={{ width: 'clamp(18px, 2vw, 22px)', height: 'clamp(18px, 2vw, 22px)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ 
                  fontWeight: '600', 
                  marginBottom: '0.375rem', 
                  fontSize: 'clamp(0.9375rem, 1.1vw, 1.0625rem)' 
                }}>
                  Powerful Analytics
                </h3>
                <p style={{ 
                  color: 'rgba(255, 255, 255, 0.8)', 
                  fontSize: 'clamp(0.875rem, 1vw, 0.9375rem)', 
                  lineHeight: '1.6' 
                }}>
                  Get actionable insights into cost trends and profitability metrics
                </p>
              </div>
            </div>
          </div>
          
          {/* Testimonial - Hide on smaller desktop screens */}
          <div 
            className="hidden 2xl:block"
            style={{
              marginTop: 'clamp(2.5rem, 3vw, 3rem)',
              padding: 'clamp(1.25rem, 1.5vw, 1.5rem)',
              borderRadius: '0.75rem',
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <p style={{ 
              fontSize: 'clamp(0.875rem, 1vw, 0.9375rem)',
              fontStyle: 'italic',
              marginBottom: 'clamp(0.875rem, 1vw, 1rem)',
              lineHeight: '1.6',
              color: 'rgba(255, 255, 255, 0.95)'
            }}>
              "This tool transformed how we manage our food costs. We've reduced waste by 30% and increased margins significantly."
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: 'clamp(36px, 3vw, 40px)',
                height: 'clamp(36px, 3vw, 40px)',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'clamp(1rem, 1.2vw, 1.125rem)',
                flexShrink: 0,
              }}>
                👨‍🍳
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  fontWeight: '600', 
                  fontSize: 'clamp(0.875rem, 1vw, 0.9375rem)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  Chef Michael Chen
                </div>
                <div style={{ 
                  fontSize: 'clamp(0.75rem, 0.9vw, 0.8125rem)', 
                  color: 'rgba(255, 255, 255, 0.8)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  Owner, Urban Bistro
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
