import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { useAuthStore } from '../../store/authSlice';
import { useVenueStore } from '../../store/venueSlice';
import type { Venue } from '../../types/api';

export const VenueRenamePage = () => {
  const navigate = useNavigate();
  const { venueId } = useParams<{ venueId: string }>();
  const user = useAuthStore((state) => state.user);
  const { venues, setVenues } = useVenueStore();
  
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingVenue, setLoadingVenue] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);

  useEffect(() => {
    const fetchVenue = async () => {
      if (!venueId) {
        setError('Venue ID is required');
        setLoadingVenue(false);
        return;
      }

      try {
        const orgId = user?.id || '00000000-0000-0000-0000-000000000001';
        const response = await apiClient.get<Venue>(`/organisations/${orgId}/venues/${venueId}`);
        setVenue(response.data);
        setName(response.data.name);
        setAddress(response.data.address || '');
      } catch (err: any) {
        if (err.response?.data?.message) {
          setError(err.response.data.message);
        } else {
          setError('Failed to load venue');
        }
      } finally {
        setLoadingVenue(false);
      }
    };

    fetchVenue();
  }, [venueId, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!name.trim()) {
      setError('Venue name is required');
      return;
    }

    if (name.length > 100) {
      setError('Venue name must be 100 characters or less');
      return;
    }

    setLoading(true);

    try {
      const orgId = user?.id || '00000000-0000-0000-0000-000000000001';
      
      const response = await apiClient.patch<Venue>(
        `/organisations/${orgId}/venues/${venueId}`,
        {
          name: name.trim(),
          address: address.trim() || undefined,
        }
      );

      // Update venue in the store
      const updatedVenues = venues.map(v => 
        v.id === venueId ? response.data : v
      );
      setVenues(updatedVenues);
      
      navigate('/venues');
    } catch (err: any) {
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else {
        setError('Failed to update venue. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loadingVenue) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        minHeight: '400px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ 
            width: '2rem', 
            height: '2rem',
            margin: '0 auto 1rem',
          }} />
          <p style={{ color: 'var(--text-secondary)' }}>Loading venue...</p>
        </div>
      </div>
    );
  }

  if (error && !venue) {
    return (
      <div className="venue-rename-page" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div className="alert alert-error">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
          <span>{error}</span>
        </div>
        <button
          onClick={() => navigate('/venues')}
          className="btn-secondary"
          style={{ marginTop: '1rem' }}
        >
          ← Back to Venues
        </button>
      </div>
    );
  }

  return (
    <div className="venue-rename-page" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <button
          onClick={() => navigate('/venues')}
          className="btn-ghost btn-sm"
          style={{ marginBottom: '1rem' }}
        >
          ← Back to Venues
        </button>
        <h1 style={{ 
          fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
          fontWeight: '700',
          color: 'var(--text-primary)',
          marginBottom: '0.5rem',
        }}>
          Edit Venue
        </h1>
        <p style={{ 
          color: 'var(--text-secondary)',
          fontSize: '0.9375rem',
        }}>
          Update venue name and address
        </p>
      </div>

      <div className="card card-lg">
        {error && venue && (
          <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
              />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="venue-name" className="form-label">
              Venue Name *
            </label>
            <input
              id="venue-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Downtown Cafe"
              maxLength={100}
              disabled={loading}
              autoFocus
            />
            <span className="form-hint">
              A unique name to identify this venue
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="venue-address" className="form-label">
              Address (Optional)
            </label>
            <textarea
              id="venue-address"
              className="form-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main Street, City, State"
              rows={3}
              disabled={loading}
              style={{ resize: 'vertical' }}
            />
            <span className="form-hint">
              The physical location of this venue
            </span>
          </div>

          <div style={{ 
            display: 'flex', 
            gap: '1rem', 
            justifyContent: 'flex-end',
            marginTop: '2rem',
          }}>
            <button
              type="button"
              onClick={() => navigate('/venues')}
              className="btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !name.trim()}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
